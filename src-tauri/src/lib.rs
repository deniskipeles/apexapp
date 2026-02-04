use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

// State to hold child processes
struct ApexState {
    apex_process: Mutex<Option<CommandChild>>,
    tunnel_process: Mutex<Option<CommandChild>>,
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
fn toggle_cf_tunnel(app: AppHandle, state: State<'_, ApexState>, start: bool) -> Result<String, String> {
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

    // Command: cloudflared tunnel --url http://localhost:5000
    let sidecar = app.shell()
        .sidecar("cloudflared")
        .map_err(|e| e.to_string())?
        .args(["tunnel", "--url", "http://localhost:5000"]);

    let (mut rx, child) = sidecar.spawn().map_err(|e| e.to_string())?;
    *tunnel_guard = Some(child);

    // Background Listener for the URL
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    // Broadcast EVERY line to the console
                    let _ = app.emit("sidecar-log", format!("[Tunnel] {}", line));

                    if line.contains(".trycloudflare.com") {
                        if let Some(url) = line.split_whitespace().find(|w| w.contains("https://")) {
                            let _ = app.emit("tunnel-url", url);
                        }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(ApexState {
            apex_process: Mutex::new(None),
            tunnel_process: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            greet, 
            run_apex_sidecar, 
            open_separate_window,
            toggle_cf_tunnel
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::Exit => {
                let state = app_handle.state::<ApexState>();
                
                // Use .take() and .map() to kill processes cleanly 
                // while ensuring the lock guard is dropped immediately.
                let _ = state.apex_process.lock().unwrap().take().map(|c| c.kill());
                let _ = state.tunnel_process.lock().unwrap().take().map(|c| c.kill());
            }
            _ => {}
        });
}