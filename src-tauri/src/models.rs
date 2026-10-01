use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SavePdfPayload {
    pub file_name: String,
    pub pdf_base64: String,
    #[serde(default)]
    pub custom_dir: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ExportFilePayload {
    pub file_name: String,
    pub base64_data: String,
    #[serde(default)]
    pub custom_dir: Option<String>,
    #[serde(default)]
    pub auto_open: Option<bool>,
}

// ── NEW OS TELEMETRY & PERIPHERAL MODELS ────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BatteryStatus {
    pub has_battery: bool,
    pub percentage: u8,
    pub is_charging: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NetworkStatus {
    pub is_online: bool,
    pub local_ip: String,
    pub gateway_ping_ms: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ScaleReading {
    pub success: bool,
    pub raw: String,
    pub weight: Option<f64>,
    pub unit: Option<String>,
    pub stable: bool,
}