use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct ApexState {
    apex_process: Mutex<Option<CommandChild>>,
    tunnel_process: Mutex<Option<CommandChild>>,
    frpc_process: Mutex<Option<CommandChild>>,
}

#[derive(Serialize, Deserialize)]
pub struct EnvVar {
    key: String,
    value: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PrinterInfo {
    pub id: String,
    pub name: String,
    #[serde(rename = "Name")]
    pub system_name: String,
    pub is_default: bool,
    #[serde(rename = "Priority")]
    pub priority: u32,
    #[serde(rename = "PrinterStatus")]
    pub printer_status: u32,
}

#[derive(Serialize, Deserialize)]
pub struct SavePdfPayload {
    pub file_name: String,
    pub pdf_base64: String,
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
    let _ = WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url.parse().unwrap()))
        .title(title)
        .inner_size(1200.0, 800.0)
        .build();
}

#[tauri::command]
fn run_apex_sidecar(app: AppHandle, state: State<'_, ApexState>) {
    let mut child_guard = state.apex_process.lock().unwrap();
    if child_guard.is_some() {
        return;
    }

    let resource_dir = app.path().resource_dir().unwrap();
    let sidecar_command = app
        .shell()
        .sidecar("apexkit")
        .unwrap()
        .current_dir(resource_dir);

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
fn toggle_cf_tunnel(
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
fn get_env_vars(app: AppHandle) -> Result<Vec<EnvVar>, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let env_path = resource_dir.join(".env");
    let mut vars = Vec::new();
    if let Ok(content) = fs::read_to_string(&env_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some((k, v)) = trimmed.split_once('=') {
                let clean_v = v.trim().trim_matches('"').trim_matches('\'').to_string();
                vars.push(EnvVar {
                    key: k.trim().to_string(),
                    value: clean_v,
                });
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
fn toggle_apex_tunnel(
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

// ── UNIVERSAL CROSS-PLATFORM PRINTING & DOCUMENT ENGINE ─────────────────────

/// Queries installed printers natively:
/// WinSpool on Windows, CUPS on Linux and macOS.
#[tauri::command]
async fn get_printers() -> Result<Vec<PrinterInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let list = printers::get_printers();
        let default_name = printers::get_default_printer().map(|p| p.name);

        Ok(list
            .into_iter()
            .map(|p| {
                let is_def = default_name.as_ref().map_or(false, |d| d == &p.name);
                PrinterInfo {
                    id: p.name.clone(),
                    name: p.name.clone(),
                    system_name: p.name.clone(),
                    is_default: is_def,
                    priority: if is_def { 1 } else { 0 },
                    printer_status: 0, // 0 = Online
                }
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Universal Silent Receipt Saver (Windows, Linux, macOS)
/// Saves base64-encoded PDF/HTML receipt data into Documents/ApexApp_Receipts with ZERO prompts.
#[tauri::command]
async fn save_receipt_pdf(payload: SavePdfPayload) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let docs_dir = get_documents_dir()
            .ok_or_else(|| "Could not locate user Documents directory".to_string())?;
        let receipts_dir = docs_dir.join("ApexApp_Receipts");
        std::fs::create_dir_all(&receipts_dir).map_err(|e| e.to_string())?;

        let output_path = receipts_dir.join(&payload.file_name);
        let bytes = base64_decode(&payload.pdf_base64)
            .map_err(|e| format!("Base64 decoding failed: {}", e))?;

        let mut file = std::fs::File::create(&output_path).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;

        println!("✅ Receipt saved silently to: {}", output_path.display());
        Ok(output_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Universal Hardware Spooler (Windows, Linux, macOS)
/// Dispatches raw text / ESC-POS / printer stream directly to the OS spooler with ZERO dialogs.
#[tauri::command]
async fn print_to_hardware(printer_id: String, raw_content: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let printer = printers::get_printer_by_name(&printer_id)
            .ok_or_else(|| format!("Printer '{}' not found", printer_id))?;

        let temp_file = std::env::temp_dir().join(format!("spool_{}.bin", uuid::Uuid::new_v4()));
        std::fs::write(&temp_file, raw_content.as_bytes()).map_err(|e| e.to_string())?;

        let result = printer.print_file(
            temp_file.to_str().unwrap(),
            printers::common::base::job::PrinterJobOptions::none(),
        );

        let _ = std::fs::remove_file(temp_file);
        result.map(|_| true).map_err(|e| format!("{:?}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Backwards-compatible file printing
#[tauri::command]
async fn print_file(printer_id: String, file_path: String, _copies: Option<usize>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let printer = printers::get_printer_by_name(&printer_id)
            .ok_or_else(|| format!("Printer '{}' not found", printer_id))?;

        printer
            .print_file(&file_path, printers::common::base::job::PrinterJobOptions::none())
            .map(|_| true)
            .map_err(|e| format!("{:?}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Backwards-compatible print_html
#[tauri::command]
async fn print_html(printer_id: String, html: String, _copies: Option<usize>) -> Result<bool, String> {
    print_to_hardware(printer_id, html).await
}

// ── UTILITY HELPERS ─────────────────────────────────────────────────────────

/// Resolves standard Documents directory cross-platform
fn get_documents_dir() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE").map(|p| std::path::PathBuf::from(p).join("Documents"))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|p| std::path::PathBuf::from(p).join("Documents"))
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("XDG_DOCUMENTS_DIR")
            .map(std::path::PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|p| std::path::PathBuf::from(p).join("Documents")))
    }
}

/// Pure Rust Base64 Decoder (Zero external dependencies)
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let clean = if let Some(idx) = input.find(',') {
        &input[idx + 1..]
    } else {
        input
    };

    let clean = clean.replace(['\r', '\n', ' '], "");
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0;

    for &byte in clean.as_bytes() {
        if byte == b'=' {
            break;
        }
        let val = TABLE
            .iter()
            .position(|&x| x == byte)
            .ok_or_else(|| "Invalid base64 character".to_string())? as u32;
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
}

#[tauri::command]
fn stop_apex_sidecar(state: State<'_, ApexState>) -> Result<String, String> {
    let mut child_guard = state.apex_process.lock().unwrap();
    if let Some(child) = child_guard.take() {
        let _ = child.kill();
        return Ok("Server Stopped".to_string());
    }
    Ok("Server was not running".to_string())
}

#[tauri::command]
fn close_app(app: AppHandle) {
    app.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────

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
            stop_apex_sidecar,
            close_app,
            open_separate_window,
            toggle_cf_tunnel,
            toggle_apex_tunnel,
            get_env_vars,
            save_env_vars,
            get_printers,
            save_receipt_pdf,
            print_to_hardware,
            print_file,
            print_html,
        ])
        .on_page_load(|window, _payload| {
            let _ = window.eval(r#"
                window.__apexapp_tools__ = {
                    search_printers: () => window.__TAURI__.core.invoke('get_printers'),
                    print_html: (printer, html, copies) => window.__TAURI__.core.invoke('print_html', {
                        printer_id: printer,
                        html: html,
                        copies: copies || 1
                    }),
                    print_file: (printer, file_path, copies) => window.__TAURI__.core.invoke('print_file', {
                        printer_id: printer,
                        file_path: file_path,
                        copies: copies || 1
                    }),
                    start_scan: () => new Promise((resolve, reject) => {
                        if (!('BarcodeDetector' in window)) return reject('BarcodeDetector not supported');
                        resolve('use_browser_api');
                    }),
                };
            "#);
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::Exit => {
                let state = app_handle.state::<ApexState>();
                let _ = state.apex_process.lock().unwrap().take().map(|c| c.kill());
                let _ = state.tunnel_process.lock().unwrap().take().map(|c| c.kill());
                let _ = state.frpc_process.lock().unwrap().take().map(|c| c.kill());
            }
            _ => {}
        });
}