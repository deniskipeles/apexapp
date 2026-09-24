// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // If bundled with a fixed WebView2 runtime (Windows 7 offline mode), tell WebView2 where it is
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = [
                exe_dir.join("webview2").join("fixed"),
                exe_dir.join("resources").join("webview2").join("fixed"),
                exe_dir.join("fixed"),
            ];
            for path in candidates {
                if path.exists() && path.join("msedgewebview2.exe").exists() {
                    std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", path);
                    break;
                }
            }
        }
    }

    apexapp_lib::run()
}