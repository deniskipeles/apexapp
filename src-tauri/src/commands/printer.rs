use crate::models::PrinterInfo;

#[tauri::command]
pub async fn get_printers() -> Result<Vec<PrinterInfo>, String> {
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
                    printer_status: 0,
                }
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_cash_drawer(printer_id: String, pin: Option<u8>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let printer = printers::get_printer_by_name(&printer_id)
            .ok_or_else(|| format!("Printer '{}' not found", printer_id))?;

        let pin_code = pin.unwrap_or(0);
        let pulse: [u8; 5] = [0x1B, 0x70, pin_code, 0x19, 0xFA];

        let temp_file = std::env::temp_dir().join(format!("drawer_{}.bin", uuid::Uuid::new_v4()));
        std::fs::write(&temp_file, &pulse).map_err(|e| e.to_string())?;

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

#[tauri::command]
pub async fn print_to_hardware(printer_id: String, raw_content: String) -> Result<bool, String> {
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

#[tauri::command]
pub async fn print_file(printer_id: String, file_path: String, _copies: Option<usize>) -> Result<bool, String> {
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

#[tauri::command]
pub async fn print_html(printer_id: String, html: String, _copies: Option<usize>) -> Result<bool, String> {
    print_to_hardware(printer_id, html).await
}