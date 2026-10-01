use crate::models::ScaleReading;

#[cfg(not(target_os = "windows"))]
use std::io::{Read, Write};

/// Emits an OS hardware frequency beep through system speakers (zero web audio lag)
#[tauri::command]
pub async fn play_system_beep(frequency: Option<u32>, duration_ms: Option<u32>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let freq = frequency.unwrap_or(1200);
        let dur = duration_ms.unwrap_or(150);

        #[cfg(target_os = "windows")]
        {
            let script = format!("[console]::beep({}, {})", freq, dur);
            let _ = std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &script])
                .spawn();
        }

        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("osascript")
                .args(["-e", "beep 1"])
                .spawn();
        }

        #[cfg(target_os = "linux")]
        {
            // \x07 is the standard ASCII audible bell (BEL)
            let _ = std::process::Command::new("sh")
                .args(["-c", "echo -ne '\x07'"])
                .spawn();
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reads weight data from a connected RS-232 / USB-to-Serial digital scale
#[tauri::command]
pub async fn read_serial_scale(port: String, baud_rate: Option<u32>) -> Result<ScaleReading, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let baud = baud_rate.unwrap_or(9600);

        #[cfg(target_os = "windows")]
        {
            let script = format!(
                r#"
                $port = New-Object System.IO.Ports.SerialPort("{}", {}, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
                $port.ReadTimeout = 1500
                $port.Open()
                $line = $port.ReadLine()
                $port.Close()
                $line
                "#,
                port, baud
            );

            let output = std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &script])
                .output()
                .map_err(|e| format!("Scale read error: {}", e))?;

            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if raw.is_empty() {
                return Ok(ScaleReading {
                    success: false,
                    raw: "Timeout: No data from scale".into(),
                    weight: None,
                    unit: None,
                    stable: false,
                });
            }

            let parsed_weight = raw
                .split(|c: char| !c.is_numeric() && c != '.' && c != '-')
                .find(|s| !s.is_empty())
                .and_then(|w| w.parse::<f64>().ok());

            let unit = if raw.to_lowercase().contains("kg") {
                Some("kg".to_string())
            } else if raw.to_lowercase().contains("lb") {
                Some("lb".to_string())
            } else {
                Some("g".to_string())
            };

            return Ok(ScaleReading {
                success: true,
                raw: raw.clone(),
                weight: parsed_weight,
                unit,
                stable: raw.contains("ST") || !raw.contains("US"),
            });
        }

        #[cfg(not(target_os = "windows"))]
        {
            let mut file = std::fs::OpenOptions::new()
                .read(true)
                .open(&port)
                .map_err(|e| format!("Failed to open port {}: {}", port, e))?;

            let mut buffer = [0u8; 128];
            let read_bytes = file.read(&mut buffer).map_err(|e| e.to_string())?;
            let raw = String::from_utf8_lossy(&buffer[..read_bytes]).trim().to_string();

            let parsed_weight = raw
                .split(|c: char| !c.is_numeric() && c != '.' && c != '-')
                .find(|s| !s.is_empty())
                .and_then(|w| w.parse::<f64>().ok());

            Ok(ScaleReading {
                success: true,
                raw,
                weight: parsed_weight,
                unit: Some("kg".into()),
                stable: true,
            })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Sends text lines to a customer-facing 2-line VFD Pole Display
#[tauri::command]
pub async fn send_pole_display(port: String, line1: String, line2: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Standard VFD clear screen (0x0C) and cursor carriage return
        let mut payload: Vec<u8> = vec![0x0C];
        payload.extend_from_slice(line1.as_bytes());
        payload.extend_from_slice(b"\r\n");
        payload.extend_from_slice(line2.as_bytes());

        #[cfg(target_os = "windows")]
        {
            let temp_file = std::env::temp_dir().join("vfd_display.bin");
            std::fs::write(&temp_file, &payload).map_err(|e| e.to_string())?;

            let script = format!("Copy-Item '{}' -Destination '\\\\.\\{}'", temp_file.display(), port);
            let _ = std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &script])
                .output();

            let _ = std::fs::remove_file(temp_file);
            Ok(true)
        }

        #[cfg(not(target_os = "windows"))]
        {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .open(&port)
                .map_err(|e| format!("Failed to open pole display at {}: {}", port, e))?;

            file.write_all(&payload).map_err(|e| e.to_string())?;
            Ok(true)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}