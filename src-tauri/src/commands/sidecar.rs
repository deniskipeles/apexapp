use crate::state::ApexState;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[tauri::command]
pub fn run_apex_sidecar(app: AppHandle, state: State<'_, ApexState>) {
    let mut child_guard = state.apex_process.lock().unwrap();
    if child_guard.is_some() {
        return;
    }

    let resource_dir = app.path().resource_dir().unwrap();
    let sidecar_command = app
        .shell()
        .sidecar("apexkit")
        .unwrap()
        .current_dir(resource_dir)
        .env("HOST", "0.0.0.0");

    match sidecar_command.spawn() {
        Ok((mut rx, child)) => {
            *child_guard = Some(child);
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let out = String::from_utf8_lossy(&line);
                            let _ = app_handle.emit("sidecar-log", format!("[ApexKit] {}", out));
                        }
                        CommandEvent::Stderr(line) => {
                            let out = String::from_utf8_lossy(&line);
                            let _ =
                                app_handle.emit("sidecar-log", format!("[ApexKit ERROR] {}", out));
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
pub fn stop_apex_sidecar(state: State<'_, ApexState>) -> Result<String, String> {
    let mut child_guard = state.apex_process.lock().unwrap();
    if let Some(child) = child_guard.take() {
        let _ = child.kill();
        return Ok("Server Stopped".to_string());
    }
    Ok("Server was not running".to_string())
}

#[tauri::command]
pub fn toggle_cf_tunnel(
    app: AppHandle,
    state: State<'_, ApexState>,
    start: bool,
    token: Option<String>,
) -> Result<String, String> {
    let mut tunnel_guard = state.tunnel_process.lock().unwrap();
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

    let mut sidecar = app
        .shell()
        .sidecar("cloudflared")
        .map_err(|e| e.to_string())?;
    let is_managed = match &token {
        Some(t) if !t.trim().is_empty() => true,
        _ => false,
    };
    if is_managed {
        sidecar = sidecar.args([
            "tunnel",
            "--no-autoupdate",
            "run",
            "--token",
            token.as_ref().unwrap().trim(),
        ]);
    } else {
        sidecar = sidecar.args(["tunnel", "--url", "http://localhost:5000"]);
    }

    let (mut rx, child) = sidecar.spawn().map_err(|e| e.to_string())?;
    *tunnel_guard = Some(child);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    let _ = app.emit("sidecar-log", format!("[Tunnel] {}", line));
                    if !is_managed && line.contains(".trycloudflare.com") {
                        if let Some(url) = line.split_whitespace().find(|w| w.contains("https://"))
                        {
                            let _ = app.emit("tunnel-url", url);
                        }
                    }
                    if is_managed
                        && (line.contains("Registered tunnel connection")
                            || line.contains("Connection"))
                    {
                        let _ = app.emit("tunnel-managed-connected", "connected");
                    }
                }
                CommandEvent::Stdout(line_bytes) => {
                    let _ = app.emit(
                        "sidecar-log",
                        format!("[Tunnel] {}", String::from_utf8_lossy(&line_bytes)),
                    );
                }
                _ => {}
            }
        }
    });
    Ok("Tunnel Starting...".to_string())
}

#[tauri::command]
pub fn toggle_apex_tunnel(
    app: AppHandle,
    state: State<'_, ApexState>,
    start: bool,
    domain: Option<String>,
    token: Option<String>,
    server_addr: Option<String>,
) -> Result<String, String> {
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

    let is_subdomain = !target_domain.contains('.');
    let domain_config = if is_subdomain {
        format!("subdomain = \"{}\"", target_domain)
    } else {
        format!("customDomains = [\"{}\"]", target_domain)
    };

    let app_data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    let config_path = app_data_dir.join("frpc.toml");

    let toml_content = format!(
        r#"
serverAddr = "{}"
serverPort = 443
user = "{}"

[transport]
protocol = "wss"

[[proxies]]
name = "apexkit-tunnel-{}"
type = "http"
localPort = 5000
{}
"#,
        srv_addr,
        tok,
        uuid::Uuid::new_v4().to_string().replace("-", "")[0..8].to_string(),
        domain_config
    );

    std::fs::write(&config_path, toml_content).map_err(|e| e.to_string())?;

    let sidecar = app
        .shell()
        .sidecar("frpc")
        .map_err(|e| e.to_string())?
        .args(["-c", config_path.to_str().unwrap()]);

    let (mut rx, child) = sidecar.spawn().map_err(|e| e.to_string())?;
    *tunnel_guard = Some(child);

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
