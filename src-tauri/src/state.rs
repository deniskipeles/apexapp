use std::sync::Mutex;
use tauri_plugin_shell::process::CommandChild;

pub struct ApexState {
    pub apex_process: Mutex<Option<CommandChild>>,
    pub tunnel_process: Mutex<Option<CommandChild>>,
    pub frpc_process: Mutex<Option<CommandChild>>,
}

impl Default for ApexState {
    fn default() -> Self {
        Self {
            apex_process: Mutex::new(None),
            tunnel_process: Mutex::new(None),
            frpc_process: Mutex::new(None),
        }
    }
}
