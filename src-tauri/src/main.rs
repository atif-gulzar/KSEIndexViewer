#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod scraper_service;
mod settings;
mod tray;
mod portfolio;
mod stocks;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use serde::Serialize;
use tauri::{Emitter, Manager, State};
use settings::{AppSettings, load_settings, save_settings};
use scraper_service::{IndexData, fetch_indices};
use portfolio::{Transaction, compute_positions};
use stocks::{StockQuote, fetch_market_watch};

struct AppState {
    latest_data: Mutex<Vec<IndexData>>,
    settings: Mutex<AppSettings>,
    transactions: Mutex<Vec<Transaction>>,
    quotes: Mutex<HashMap<String, StockQuote>>,
}

#[derive(Debug, Clone, Serialize)]
struct PortfolioRow {
    symbol: String,
    total_shares: f64,
    average_price: f64,
    current_price: f64,
    today_change_rs: f64,
    today_change_pct: f64,
    current_worth: f64,
    unrealized_gain_loss: f64,
    unrealized_pct: f64,
    realized_gain_loss: f64,
}

#[derive(Debug, Clone, Serialize)]
struct PortfolioSummary {
    rows: Vec<PortfolioRow>,
    total_unrealized: f64,
    total_realized: f64,
    total_worth: f64,
    total_cost: f64,
    total_unrealized_pct: f64,
    configured: bool,
}

fn build_summary(
    txns: &[Transaction],
    quotes: &HashMap<String, StockQuote>,
    configured: bool,
) -> PortfolioSummary {
    let positions = compute_positions(txns);
    let mut rows: Vec<PortfolioRow> = Vec::with_capacity(positions.len());
    let mut total_unrealized = 0.0;
    let mut total_realized = 0.0;
    let mut total_worth = 0.0;
    let mut total_cost = 0.0;

    for p in positions {
        let quote = quotes.get(&p.symbol);
        let current_price = quote.map(|q| q.current).unwrap_or(0.0);
        let today_change_rs = quote.map(|q| q.change).unwrap_or(0.0);
        let today_change_pct = quote.map(|q| q.percent_change).unwrap_or(0.0);
        let current_worth = p.total_shares * current_price;
        let cost_basis = p.total_shares * p.average_price;
        let unrealized = if current_price > 0.0 {
            (current_price - p.average_price) * p.total_shares
        } else {
            0.0
        };
        let unrealized_pct = if cost_basis > 0.0 {
            (unrealized / cost_basis) * 100.0
        } else {
            0.0
        };

        total_unrealized += unrealized;
        total_realized += p.realized_gain_loss;
        total_worth += current_worth;
        total_cost += cost_basis;

        rows.push(PortfolioRow {
            symbol: p.symbol,
            total_shares: p.total_shares,
            average_price: p.average_price,
            current_price,
            today_change_rs,
            today_change_pct,
            current_worth,
            unrealized_gain_loss: unrealized,
            unrealized_pct,
            realized_gain_loss: p.realized_gain_loss,
        });
    }

    let total_unrealized_pct = if total_cost > 0.0 {
        (total_unrealized / total_cost) * 100.0
    } else {
        0.0
    };

    PortfolioSummary {
        rows,
        total_unrealized,
        total_realized,
        total_worth,
        total_cost,
        total_unrealized_pct,
        configured,
    }
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

#[tauri::command]
fn get_portfolio(state: State<AppState>) -> PortfolioSummary {
    let txns = state.transactions.lock().unwrap().clone();
    let quotes = state.quotes.lock().unwrap().clone();
    let configured = state.settings.lock().unwrap().apps_script_url
        .as_ref()
        .map(|u| !u.trim().is_empty())
        .unwrap_or(false);
    build_summary(&txns, &quotes, configured)
}

#[tauri::command]
async fn refresh_portfolio(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<PortfolioSummary, String> {
    let url_opt = state.settings.lock().unwrap().apps_script_url.clone();

    // Fetch market-watch (works regardless of whether sheet is configured)
    if let Ok(quotes) = fetch_market_watch().await {
        let mut q = state.quotes.lock().unwrap();
        *q = quotes;
    }

    // Fetch transactions if a sheet is configured
    if let Some(url) = url_opt.as_ref().filter(|u| !u.trim().is_empty()) {
        match portfolio::fetch_transactions(url).await {
            Ok(txns) => {
                portfolio::save_cache(&txns);
                let mut t = state.transactions.lock().unwrap();
                *t = txns;
            }
            Err(e) => {
                // Surface error but still return whatever we have cached
                let _ = app.emit("portfolio-error", &e);
            }
        }
    }

    let summary = {
        let txns = state.transactions.lock().unwrap().clone();
        let quotes = state.quotes.lock().unwrap().clone();
        let configured = url_opt.as_ref().map(|u| !u.trim().is_empty()).unwrap_or(false);
        build_summary(&txns, &quotes, configured)
    };
    let _ = app.emit("portfolio-updated", &summary);
    Ok(summary)
}

#[tauri::command]
async fn add_transaction(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    symbol: String,
    side: String,
    shares: f64,
    price: f64,
    date: String,
) -> Result<PortfolioSummary, String> {
    let url = {
        let s = state.settings.lock().unwrap();
        s.apps_script_url.clone()
    };
    let url = url
        .filter(|u| !u.trim().is_empty())
        .ok_or_else(|| "Google Sheet not configured. Open Settings and paste your Apps Script Web App URL.".to_string())?;

    let symbol_upper = symbol.trim().to_uppercase();
    let side_upper = side.trim().to_uppercase();
    if symbol_upper.is_empty() {
        return Err("Symbol is required".to_string());
    }
    if side_upper != "BUY" && side_upper != "SELL" {
        return Err("Side must be BUY or SELL".to_string());
    }
    if shares <= 0.0 || price <= 0.0 {
        return Err("Shares and price must be greater than zero".to_string());
    }

    let txn = Transaction {
        date,
        symbol: symbol_upper,
        side: side_upper,
        shares,
        price,
    };

    portfolio::post_transaction(&url, &txn).await?;

    // Append to local cache
    {
        let mut t = state.transactions.lock().unwrap();
        t.push(txn);
        portfolio::save_cache(&t);
    }

    let summary = {
        let txns = state.transactions.lock().unwrap().clone();
        let quotes = state.quotes.lock().unwrap().clone();
        build_summary(&txns, &quotes, true)
    };
    let _ = app.emit("portfolio-updated", &summary);
    Ok(summary)
}

#[tauri::command]
fn get_apps_script_code() -> String {
    portfolio::apps_script_setup_code().to_string()
}

fn main() {
    let settings = load_settings();
    let cached_txns = portfolio::load_cache();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(AppState {
            latest_data: Mutex::new(Vec::new()),
            settings: Mutex::new(settings.clone()),
            transactions: Mutex::new(cached_txns),
            quotes: Mutex::new(HashMap::new()),
        })
        .setup(move |app| {
            tray::create_tray(app.handle())?;

            // Set initial always-on-top from settings
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(settings.always_on_top);
            }

            // Start auto-refresh timer
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                loop {
                    rt.block_on(async {
                        // Indices
                        if let Ok(data) = fetch_indices().await {
                            let state = handle.state::<AppState>();
                            let pinned = {
                                let mut latest = state.latest_data.lock().unwrap();
                                *latest = data.clone();
                                state.settings.lock().unwrap().pinned_to_tray_index.clone()
                            };
                            tray::update_tray_icon(&handle, &data, &pinned);
                            let _ = handle.emit("data-updated", &data);
                        }

                        // Stock quotes (drives the Portfolio tab)
                        if let Ok(quotes) = fetch_market_watch().await {
                            let state = handle.state::<AppState>();
                            *state.quotes.lock().unwrap() = quotes;
                        }

                        // Transactions: only refetch from Sheet when configured.
                        let url_opt = {
                            let state = handle.state::<AppState>();
                            let url = state.settings.lock().unwrap().apps_script_url.clone();
                            url
                        };
                        if let Some(url) = url_opt.as_ref().filter(|u| !u.trim().is_empty()) {
                            if let Ok(txns) = portfolio::fetch_transactions(url).await {
                                portfolio::save_cache(&txns);
                                let state = handle.state::<AppState>();
                                *state.transactions.lock().unwrap() = txns;
                            }
                        }

                        // Emit fresh portfolio summary
                        let summary = {
                            let state = handle.state::<AppState>();
                            let txns = state.transactions.lock().unwrap().clone();
                            let quotes = state.quotes.lock().unwrap().clone();
                            let configured = url_opt
                                .as_ref()
                                .map(|u| !u.trim().is_empty())
                                .unwrap_or(false);
                            build_summary(&txns, &quotes, configured)
                        };
                        let _ = handle.emit("portfolio-updated", &summary);
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
            get_portfolio,
            refresh_portfolio,
            add_transaction,
            get_apps_script_code,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
