use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub enabled_indices: Vec<String>,
    pub pinned_to_tray_index: String,
    pub refresh_interval_seconds: u64,
    pub always_on_top: bool,
    pub launch_at_startup: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            enabled_indices: vec![
                "KSE100".to_string(),
                "KSE30".to_string(),
                "KMI30".to_string(),
                "ALLSHR".to_string(),
            ],
            pinned_to_tray_index: "KSE100".to_string(),
            refresh_interval_seconds: 300,
            always_on_top: true,
            launch_at_startup: false,
        }
    }
}

fn settings_path() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("KSEIndexViewer");
    fs::create_dir_all(&path).ok();
    path.push("settings.json");
    path
}

pub fn load_settings() -> AppSettings {
    let path = settings_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(settings) = serde_json::from_str(&content) {
                return settings;
            }
        }
    }
    AppSettings::default()
}

pub fn save_settings(settings: &AppSettings) {
    let path = settings_path();
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        fs::write(path, json).ok();
    }
}
