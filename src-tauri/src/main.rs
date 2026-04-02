#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod scraper_service;
mod settings;
mod tray;

use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager, State};
use settings::{AppSettings, load_settings, save_settings};
use scraper_service::{IndexData, fetch_indices};

struct AppState {
    latest_data: Mutex<Vec<IndexData>>,
    settings: Mutex<AppSettings>,
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> AppSettings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_app_settings(state: State<AppState>, new_settings: AppSettings) -> bool {
    let mut s = state.settings.lock().unwrap();
    *s = new_settings.clone();
    save_settings(&new_settings);
    true
}

#[tauri::command]
async fn refresh_data(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<Vec<IndexData>, String> {
    match fetch_indices().await {
        Ok(data) => {
            {
                let mut latest = state.latest_data.lock().unwrap();
                *latest = data.clone();
            }
            let settings = state.settings.lock().unwrap().clone();
            tray::update_tray_icon(&app, &data, &settings.pinned_to_tray_index);
            Ok(data)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn get_all_indices(state: State<AppState>) -> Vec<IndexData> {
    state.latest_data.lock().unwrap().clone()
}

#[tauri::command]
fn set_always_on_top(app: tauri::AppHandle, on_top: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(on_top);
    }
}

fn main() {
    let settings = load_settings();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(AppState {
            latest_data: Mutex::new(Vec::new()),
            settings: Mutex::new(settings.clone()),
        })
        .setup(move |app| {
            tray::create_tray(app.handle())?;

            // Set initial always-on-top from settings
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(settings.always_on_top);
            }

            // Start auto-refresh timer
            let handle = app.handle().clone();
            let interval = settings.refresh_interval_seconds;
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                loop {
                    rt.block_on(async {
                        if let Ok(data) = fetch_indices().await {
                            let state = handle.state::<AppState>();
                            let settings = {
                                let mut latest = state.latest_data.lock().unwrap();
                                *latest = data.clone();
                                state.settings.lock().unwrap().clone()
                            };
                            tray::update_tray_icon(&handle, &data, &settings.pinned_to_tray_index);
                            let _ = handle.emit("data-updated", &data);
                        }
                    });
                    let current_interval = {
                        let state = handle.state::<AppState>();
                        let interval = state.settings.lock().unwrap().refresh_interval_seconds;
                        interval
                    };
                    std::thread::sleep(Duration::from_secs(current_interval));
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_app_settings,
            refresh_data,
            get_all_indices,
            set_always_on_top,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
