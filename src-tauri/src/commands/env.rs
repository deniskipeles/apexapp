use crate::models::EnvVar;
use std::fs;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn get_env_vars(app: AppHandle) -> Result<Vec<EnvVar>, String> {
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
pub fn save_env_vars(app: AppHandle, vars: Vec<EnvVar>) -> Result<(), String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let env_path = resource_dir.join(".env");
    let mut content = String::new();
    for var in vars {
        content.push_str(&format!("{}=\"{}\"\n", var.key, var.value));
    }
    fs::write(&env_path, content).map_err(|e| e.to_string())?;
    Ok(())
}