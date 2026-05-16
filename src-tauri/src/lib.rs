use std::sync::Mutex;
use std::fs;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use serde::{Serialize, Deserialize};

// State to hold child processes
struct ApexState {
    apex_process: Mutex<Option<CommandChild>>,
    tunnel_process: Mutex<Option<CommandChild>>,
    frpc_process: Mutex<Option<CommandChild>>,
}

// Struct for Environment Variables
#[derive(Serialize, Deserialize)]
pub struct EnvVar {
    key: String,
    value: String,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn open_separate_window(app: AppHandle, label: String, title: String, url: String) {
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.set_focus();
        return;
    }

    println!("Opening external window: {} -> {}", label, url);
    let _ = WebviewWindowBuilder::new(
        &app,
        label, 
        WebviewUrl::External(url.parse().unwrap())
    )
    .title(title)
    .inner_size(1200.0, 800.0)
    .build();
}

#[tauri::command]
fn run_apex_sidecar(app: AppHandle, state: State<'_, ApexState>) {
    let mut child_guard = state.apex_process.lock().unwrap();
    if child_guard.is_some() {
        return; // Already running
    }

    let resource_dir = app.path().resource_dir().unwrap();
    let sidecar_command = app.shell()
        .sidecar("apexkit")
        .unwrap()
        .current_dir(resource_dir);

    match sidecar_command.spawn() {
        Ok((mut rx, child)) => {
            *child_guard = Some(child);
            let app_handle = app.clone(); // Clone for the thread

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let out = String::from_utf8_lossy(&line);
                            println!("[ApexKit]: {}", out);
                            let _ = app_handle.emit("sidecar-log", format!("[ApexKit] {}", out));
                        }
                        CommandEvent::Stderr(line) => {
                            let out = String::from_utf8_lossy(&line);
                            eprintln!("[ApexKit Error]: {}", out);
                            let _ = app_handle.emit("sidecar-log", format!("[ApexKit ERROR] {}", out));
                        }
                        _ => {}
                    }
                }
            });
        }
        Err(e) => eprintln!("Failed to spawn apexkit: {}", e),
    }
}

#[tauri::command]
fn toggle_cf_tunnel(app: AppHandle, state: State<'_, ApexState>, start: bool, token: Option<String>) -> Result<String, String> {
    let mut tunnel_guard = state.tunnel_process.lock().unwrap();

    // STOP TUNNEL
    if !start {
        if let Some(child) = tunnel_guard.take() {
            let _ = child.kill();
            return Ok("Tunnel Stopped".to_string());
        }
        return Ok("Tunnel was not running".to_string());
    }

    // START TUNNEL
    if tunnel_guard.is_some() {
        return Ok("Tunnel already running".to_string());
    }

    // Determine arguments based on whether a token is provided
    let mut sidecar = app.shell().sidecar("cloudflared").map_err(|e| e.to_string())?;

    let is_managed = match &token {
        Some(t) if !t.trim().is_empty() => true,
        _ => false,
    };

    if is_managed {
        // Run as a managed tunnel using the token
        sidecar = sidecar.args(["tunnel", "--no-autoupdate", "run", "--token", token.as_ref().unwrap().trim()]);
    } else {
        // Run as a quick (free) tunnel pointing to localhost:5000
        sidecar = sidecar.args(["tunnel", "--url", "http://localhost:5000"]);
    }

    let (mut rx, child) = sidecar.spawn().map_err(|e| e.to_string())?;
    *tunnel_guard = Some(child);

    // Background Listener for logs
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    let _ = app.emit("sidecar-log", format!("[Tunnel] {}", line));

                    // Quick Tunnel Output Extraction
                    if !is_managed && line.contains(".trycloudflare.com") {
                        if let Some(url) = line.split_whitespace().find(|w| w.contains("https://")) {
                            let _ = app.emit("tunnel-url", url);
                        }
                    }
                    
                    // Managed Tunnel Connection Confirmation
                    if is_managed && (line.contains("Registered tunnel connection") || line.contains("Connection")) {
                        // Tell the frontend the connection is established
                        let _ = app.emit("tunnel-managed-connected", "connected");
                    }
                }
                CommandEvent::Stdout(line_bytes) => {
                    let _ = app.emit("sidecar-log", format!("[Tunnel] {}", String::from_utf8_lossy(&line_bytes)));
                }
                _ => {}
            }
        }
    });

    Ok("Tunnel Starting...".to_string())
}

#[tauri::command]
fn get_env_vars(app: AppHandle) -> Result<Vec<EnvVar>, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let env_path = resource_dir.join(".env");
    
    let mut vars = Vec::new();
    if let Ok(content) = fs::read_to_string(&env_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') { continue; }
            if let Some((k, v)) = trimmed.split_once('=') {
                let clean_v = v.trim().trim_matches('"').trim_matches('\'').to_string();
                vars.push(EnvVar { key: k.trim().to_string(), value: clean_v });
            }
        }
    }
    Ok(vars)
}

#[tauri::command]
fn save_env_vars(app: AppHandle, vars: Vec<EnvVar>) -> Result<(), String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let env_path = resource_dir.join(".env");
    
    let mut content = String::new();
    for var in vars {
        content.push_str(&format!("{}=\"{}\"\n", var.key, var.value));
    }
    
    fs::write(&env_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn toggle_apex_tunnel(app: AppHandle, state: State<'_, ApexState>, start: bool, domain: Option<String>, token: Option<String>, server_addr: Option<String>) -> Result<String, String> {
    let mut tunnel_guard = state.frpc_process.lock().unwrap();

    if !start {
        if let Some(child) = tunnel_guard.take() {
            let _ = child.kill();
            return Ok("Tunnel Stopped".to_string());
        }
        return Ok("Tunnel was not running".to_string());
    }

    if tunnel_guard.is_some() {
        return Ok("Tunnel already running".to_string());
    }

    let target_domain = domain.ok_or("Domain is required".to_string())?;
    let tok = token.ok_or("Token is required".to_string())?;
    let srv_addr = server_addr.unwrap_or_else(|| "apexkit.io".to_string());
    
    // INTELLIGENT DETECTION: Agency Mode (Subdomain) vs PaaS Mode (Custom Domain)
    let is_subdomain = !target_domain.contains('.');
    let domain_config = if is_subdomain {
        format!("subdomain = \"{}\"", target_domain)
    } else {
        format!("customDomains = [\"{}\"]", target_domain)
    };

    let app_data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    let config_path = app_data_dir.join("frpc.toml");
    
    // Generate WSS-based config (Bypasses Firewalls & Supports PaaS LBs)
    let toml_content = format!(r#"
serverAddr = "{}"
serverPort = 443

[transport]
protocol = "wss"
path = "/_frpc"
tls.enable = true

[metas]
token = "{}"

[[proxies]]
name = "apexkit-tunnel-{}"
type = "http"
localPort = 5000
{}
"#, srv_addr, tok, uuid::Uuid::new_v4().to_string().replace("-", "")[0..8].to_string(), domain_config);

    std::fs::write(&config_path, toml_content).map_err(|e| e.to_string())?;

    let sidecar = app.shell()
        .sidecar("frpc").map_err(|e| e.to_string())?
        .args(["-c", config_path.to_str().unwrap()]);

    let (mut rx, child) = sidecar.spawn().map_err(|e| e.to_string())?;
    *tunnel_guard = Some(child);

    // Calculate final URL for the UI
    let final_url = if is_subdomain {
        format!("https://{}.{}", target_domain, srv_addr)
    } else {
        format!("https://{}", target_domain)
    };

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line_bytes) | CommandEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    let _ = app.emit("sidecar-log", format!("[Tunnel] {}", line));

                    if line.contains("start proxy success") {
                        let _ = app.emit("apex-tunnel-connected", final_url.clone());
                    }
                    if line.contains("Unauthorized") || line.contains("not authorized") {
                         let _ = app.emit("apex-tunnel-error", "Invalid Token or Domain mismatch.");
                    }
                }
                _ => {}
            }
        }
    });

    Ok("Starting Tunnel...".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(ApexState {
            apex_process: Mutex::new(None),
            tunnel_process: Mutex::new(None),
            frpc_process: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            greet, 
            run_apex_sidecar, 
            open_separate_window,
            toggle_cf_tunnel,
            toggle_apex_tunnel,
            get_env_vars,
            save_env_vars
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::Exit => {
                let state = app_handle.state::<ApexState>();
                let _ = state.apex_process.lock().unwrap().take().map(|c| c.kill());
                let _ = state.tunnel_process.lock().unwrap().take().map(|c| c.kill());
            }
            _ => {}
        });
}