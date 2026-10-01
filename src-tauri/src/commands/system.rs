use crate::models::{BatteryStatus, NetworkStatus};
use crate::utils::base64_decode;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
pub async fn open_separate_window(app: AppHandle, label: String, title: String, url: String) {
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
pub fn close_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn set_kiosk_mode(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window.set_fullscreen(enabled).map_err(|e| e.to_string())?;
    window.set_always_on_top(enabled).map_err(|e| e.to_string())?;
    window.set_resizable(!enabled).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_fullscreen(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window.set_fullscreen(enabled).map_err(|e| e.to_string())
}

/// Triggers OS biometric or supervisor authentication prompt
#[tauri::command]
pub async fn authenticate_biometrics(reason: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            // Windows Security Credentials prompt fallback
            let script = format!(
                r#"
                Add-Type -AssemblyName System.Windows.Forms
                $cred = $host.UI.PromptForCredential("Supervisor Authorization", "{}", "", "")
                if ($cred) {{ exit 0 }} else {{ exit 1 }}
                "#,
                reason.replace('"', "`\"")
            );
            let status = std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &script])
                .status()
                .map_err(|e| e.to_string())?;
            return Ok(status.success());
        }

        #[cfg(target_os = "macos")]
        {
            let script = format!(
                r#"do shell script "echo 1" with prompt "{}" with administrator privileges"#,
                reason.replace('"', "\\\"")
            );
            let status = std::process::Command::new("osascript")
                .args(["-e", &script])
                .status()
                .map_err(|e| e.to_string())?;
            return Ok(status.success());
        }

        #[cfg(target_os = "linux")]
        {
            let status = std::process::Command::new("zenity")
                .args(["--password", "--title=Supervisor Authorization"])
                .status()
                .map_err(|e| e.to_string())?;
            return Ok(status.success());
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reads system battery percentage and charging state
#[tauri::command]
pub async fn get_battery_status() -> Result<BatteryStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        {
            let script = r#"
            $b = Get-CimInstance Win32_Battery
            if ($b) {
                $isCharging = ($b.BatteryStatus -eq 2)
                "$($b.EstimatedChargeRemaining)|$isCharging"
            } else {
                "NO_BATTERY"
            }
            "#;
            if let Ok(out) = std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", script])
                .output()
            {
                let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if text == "NO_BATTERY" || text.is_empty() {
                    return Ok(BatteryStatus { has_battery: false, percentage: 100, is_charging: true });
                }
                let parts: Vec<&str> = text.split('|').collect();
                let pct = parts.get(0).and_then(|p| p.parse::<u8>().ok()).unwrap_or(100);
                let charging = parts.get(1).map_or(false, |c| *c == "True");
                return Ok(BatteryStatus { has_battery: true, percentage: pct, is_charging: charging });
            }
        }

        #[cfg(target_os = "macos")]
        {
            if let Ok(out) = std::process::Command::new("pmset").arg("-g").arg("batt").output() {
                let text = String::from_utf8_lossy(&out.stdout);
                if let Some(pct_str) = text.split('\t').nth(1) {
                    if let Some(pct) = pct_str.split('%').next().and_then(|p| p.trim().parse::<u8>().ok()) {
                        let is_charging = text.contains("charging") || text.contains("AC Power");
                        return Ok(BatteryStatus { has_battery: true, percentage: pct, is_charging });
                    }
                }
            }
        }

        Ok(BatteryStatus { has_battery: false, percentage: 100, is_charging: true })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Query local network telemetry and test gateway ping
#[tauri::command]
pub async fn get_network_status() -> Result<NetworkStatus, String> {
    let local_ip = get_local_ip().unwrap_or_else(|_| "127.0.0.1".into());

    let ping_ms = tauri::async_runtime::spawn_blocking(|| {
        let start = std::time::Instant::now();
        if let Ok(stream) = std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([8, 8, 8, 8], 53)),
            std::time::Duration::from_millis(1000),
        ) {
            drop(stream);
            Some(start.elapsed().as_millis() as u64)
        } else {
            None
        }
    })
    .await
    .unwrap_or(None);

    Ok(NetworkStatus {
        is_online: ping_ms.is_some(),
        local_ip,
        gateway_ping_ms: ping_ms,
    })
}

#[tauri::command]
pub fn get_local_ip() -> Result<String, String> {
    use std::net::UdpSocket;

    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                let ip = addr.ip();
                if !ip.is_loopback() {
                    return Ok(ip.to_string());
                }
            }
        }
    }
    Ok("127.0.0.1".to_string())
}

#[tauri::command]
pub async fn show_system_notification(title: String, body: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let script = format!(
                r#"
                [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
                $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
                $textNodes = $template.GetElementsByTagName("text")
                $textNodes.Item(0).AppendChild($template.CreateTextNode("{}")) > $null
                $textNodes.Item(1).AppendChild($template.CreateTextNode("{}")) > $null
                $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
                [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("ApexApp").Show($toast)
                "#,
                title.replace('"', "`\""),
                body.replace('"', "`\"")
            );
            let _ = std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &script])
                .spawn();
        }

        #[cfg(target_os = "macos")]
        {
            let script = format!(
                r#"display notification "{}" with title "{}""#,
                body.replace('"', "\\\""),
                title.replace('"', "\\\"")
            );
            let _ = std::process::Command::new("osascript")
                .args(["-e", &script])
                .spawn();
        }

        #[cfg(target_os = "linux")]
        {
            let _ = std::process::Command::new("notify-send")
                .args([&title, &body])
                .spawn();
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn set_dynamic_icon(window: WebviewWindow, icon_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&icon_path);
    if !path.exists() {
        return Err(format!("Icon file does not exist at '{}'", icon_path));
    }

    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let image = tauri::image::Image::from_bytes(&bytes).map_err(|e| e.to_string())?;
    window.set_icon(image).map_err(|e| e.to_string())
}

/// Receives a PNG base64 string, validates the PNG header, saves it to disk, and applies it to the window
#[tauri::command]
pub async fn update_app_icon(
    app: AppHandle,
    window: WebviewWindow,
    png_base64: String,
) -> Result<String, String> {
    let bytes = base64_decode(&png_base64).map_err(|e| format!("Base64 decoding failed: {}", e))?;

    // Verify standard 8-byte PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if bytes.len() < 8 || &bytes[0..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("Verification failed: Image is not a valid PNG binary.".to_string());
    }

    // Save to persistent app data directory so the custom icon survives application restarts
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    let icon_path = app_dir.join("custom_app_icon.png");
    std::fs::write(&icon_path, &bytes).map_err(|e| e.to_string())?;

    // Apply directly to the live OS window & taskbar
    let image = tauri::image::Image::from_bytes(&bytes).map_err(|e| e.to_string())?;
    window.set_icon(image).map_err(|e| e.to_string())?;

    println!("🎨 Custom window icon updated & persisted to: {}", icon_path.display());
    Ok(icon_path.to_string_lossy().to_string())
}

/// Removes custom icon and restores the bundled default app icon
#[tauri::command]
pub async fn reset_app_icon(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let icon_path = app_dir.join("custom_app_icon.png");
    if icon_path.exists() {
        let _ = std::fs::remove_file(icon_path);
    }

    // In Tauri v2, default_window_icon() is accessed on AppHandle
    if let Some(default_icon) = app.default_window_icon() {
        let _ = window.set_icon(default_icon.clone());
    }
    Ok(())
}

/// Updates the OS window title and persists the custom name to disk
#[tauri::command]
pub async fn update_app_name(
    app: AppHandle,
    window: WebviewWindow,
    name: String,
) -> Result<String, String> {
    let clean_name = name.trim().to_string();
    if clean_name.is_empty() {
        return Err("App name cannot be empty".to_string());
    }

    // Save to persistent app data directory
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    let name_path = app_dir.join("custom_app_name.txt");
    std::fs::write(&name_path, clean_name.as_bytes()).map_err(|e| e.to_string())?;

    // Update the live desktop window titlebar
    window.set_title(&clean_name).map_err(|e| e.to_string())?;

    println!("🏷️ Custom window title updated to: '{}'", clean_name);
    Ok(clean_name)
}

/// Resets the app name and window title back to default "ApexApp"
#[tauri::command]
pub async fn reset_app_name(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let name_path = app_dir.join("custom_app_name.txt");
    if name_path.exists() {
        let _ = std::fs::remove_file(name_path);
    }

    window.set_title("ApexApp").map_err(|e| e.to_string())?;
    Ok(())
}