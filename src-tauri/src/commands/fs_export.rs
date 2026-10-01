use crate::models::{ExportFilePayload, SavePdfPayload};
use crate::utils::{base64_decode, get_documents_dir};
use std::io::Write;

#[tauri::command]
pub fn get_default_receipts_dir() -> Result<String, String> {
    let docs = get_documents_dir().ok_or_else(|| "Could not locate Documents folder".to_string())?;
    Ok(docs.join("ApexApp_Receipts").to_string_lossy().to_string())
}

#[tauri::command]
pub async fn select_directory() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        {
            let script = r#"
                Add-Type -AssemblyName System.Windows.Forms
                $f = New-Object System.Windows.Forms.FolderBrowserDialog
                $f.Description = "Select Directory for Saved Print Files"
                if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                    $f.SelectedPath
                }
            "#;
            if let Ok(output) = std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", script])
                .output()
            {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(Some(path));
                }
            }
            Ok(None)
        }
        #[cfg(target_os = "macos")]
        {
            if let Ok(output) = std::process::Command::new("osascript")
                .args(["-e", "POSIX path of (choose folder with prompt \"Select Directory for Saved Print Files:\")"])
                .output()
            {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(Some(path));
                }
            }
            Ok(None)
        }
        #[cfg(target_os = "linux")]
        {
            if let Ok(out) = std::process::Command::new("zenity")
                .args(["--file-selection", "--directory", "--title=Select Directory for Saved Print Files"])
                .output()
            {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(Some(path));
                }
            } else if let Ok(out) = std::process::Command::new("kdialog")
                .args(["--getexistingdirectory"])
                .output()
            {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(Some(path));
                }
            }
            Ok(None)
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_file(payload: ExportFilePayload) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let export_dir = if let Some(custom) = &payload.custom_dir {
            if !custom.trim().is_empty() {
                std::path::PathBuf::from(custom.trim())
            } else {
                get_documents_dir()
                    .ok_or_else(|| "Could not locate user Documents directory".to_string())?
                    .join("ApexApp_Exports")
            }
        } else {
            get_documents_dir()
                .ok_or_else(|| "Could not locate user Documents directory".to_string())?
                .join("ApexApp_Exports")
        };

        std::fs::create_dir_all(&export_dir).map_err(|e| e.to_string())?;

        let output_path = export_dir.join(&payload.file_name);
        let bytes = base64_decode(&payload.base64_data)
            .map_err(|e| format!("Base64 decoding failed: {}", e))?;

        let mut file = std::fs::File::create(&output_path).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;

        if payload.auto_open.unwrap_or(false) {
            #[cfg(target_os = "windows")]
            let _ = std::process::Command::new("cmd")
                .args(["/C", "start", "", output_path.to_str().unwrap()])
                .spawn();

            #[cfg(target_os = "macos")]
            let _ = std::process::Command::new("open")
                .arg(&output_path)
                .spawn();

            #[cfg(target_os = "linux")]
            let _ = std::process::Command::new("xdg-open")
                .arg(&output_path)
                .spawn();
        }

        Ok(output_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_receipt_pdf(payload: SavePdfPayload) -> Result<String, String> {
    export_file(ExportFilePayload {
        file_name: payload.file_name,
        base64_data: payload.pdf_base64,
        custom_dir: payload.custom_dir,
        auto_open: Some(false),
    })
    .await
}