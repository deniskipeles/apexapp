pub mod commands;
pub mod models;
pub mod state;
pub mod utils;

use state::ApexState;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(ApexState::default())
        .setup(|app| {
            // Restore custom branding (icon and name) if previously set
            if let Ok(app_dir) = app.path().app_data_dir() {
                if let Some(window) = app.get_webview_window("main") {
                    // Restore custom icon
                    let saved_icon = app_dir.join("custom_app_icon.png");
                    if saved_icon.exists() {
                        if let Ok(bytes) = std::fs::read(&saved_icon) {
                            if let Ok(image) = tauri::image::Image::from_bytes(&bytes) {
                                let _ = window.set_icon(image);
                            }
                        }
                    }

                    // Restore custom window title
                    let saved_name = app_dir.join("custom_app_name.txt");
                    if saved_name.exists() {
                        if let Ok(name) = std::fs::read_to_string(&saved_name) {
                            let clean = name.trim();
                            if !clean.is_empty() {
                                let _ = window.set_title(clean);
                            }
                        }
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // System & Kiosk
            commands::greet,
            commands::close_app,
            commands::open_separate_window,
            commands::set_fullscreen,
            commands::set_kiosk_mode,
            commands::authenticate_biometrics,
            commands::get_battery_status,
            commands::get_network_status,
            commands::get_local_ip,
            commands::show_system_notification,
            commands::update_app_icon,
            commands::reset_app_icon,
            commands::set_dynamic_icon,
            commands::update_app_name,
            commands::reset_app_name,
            // Sidecars & Tunnels
            commands::run_apex_sidecar,
            commands::stop_apex_sidecar,
            commands::toggle_cf_tunnel,
            commands::toggle_apex_tunnel,
            // Configuration
            commands::get_env_vars,
            commands::save_env_vars,
            // Printing & Cash Drawer
            commands::get_printers,
            commands::open_cash_drawer,
            commands::print_to_hardware,
            commands::print_file,
            commands::print_html,
            // File Export & Dialogs
            commands::get_default_receipts_dir,
            commands::select_directory,
            commands::save_receipt_pdf,
            commands::export_file,
            // POS Peripherals
            commands::play_system_beep,
            commands::read_serial_scale,
            commands::send_pole_display,
        ])
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