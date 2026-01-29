use std::sync::Mutex;
use tauri::{AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

// State to hold the child process handle safely
struct ApexState {
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// COMMAND: Opens a separate native window (Fast Mode)
#[tauri::command]
async fn open_separate_window(app: AppHandle, label: String, title: String, url: String) {
    // 1. Check if window already exists (focus it instead of re-opening)
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.set_focus();
        return;
    }

    // 2. Create new native window
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

// COMMAND: Spawns the sidecar binary
#[tauri::command]
fn run_apex_sidecar(app: AppHandle, state: State<'_, ApexState>) {
    // Check if already running to prevent duplicates
    let mut child_guard = state.child.lock().unwrap();
    if child_guard.is_some() {
        println!("ApexKit is already running.");
        return;
    }

    let sidecar_command = app.shell().sidecar("apexkit").unwrap();

    // Capture the 'child' process handle
    let (mut rx, child) = sidecar_command
        .spawn()
        .expect("Failed to spawn apexkit sidecar");

    // Store it in the global state
    *child_guard = Some(child);

    // Run the output listener in the background
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    println!("[ApexKit]: {}", line);
                }
                CommandEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    eprintln!("[ApexKit Error]: {}", line);
                }
                _ => {}
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        // Initialize State
        .manage(ApexState {
            child: Mutex::new(None),
        })
        // Register Commands
        .invoke_handler(tauri::generate_handler![greet, run_apex_sidecar, open_separate_window])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // Handle App Exit (Kill Process)
        .run(|app_handle, event| match event {
            RunEvent::Exit => {
                println!("App is exiting, killing ApexKit...");
                let state = app_handle.state::<ApexState>();
                let mut child_guard = state.child.lock().unwrap();
                
                if let Some(child) = child_guard.take() {
                    if let Err(e) = child.kill() {
                        eprintln!("Failed to kill ApexKit sidecar: {}", e);
                    } else {
                        println!("ApexKit sidecar killed successfully.");
                    }
                }
            }
            _ => {}
        });
}