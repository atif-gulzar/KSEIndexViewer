use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub date: String,
    pub symbol: String,
    pub side: String, // "BUY" or "SELL"
    pub shares: f64,
    pub price: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub symbol: String,
    pub total_shares: f64,
    pub average_price: f64,
    pub realized_gain_loss: f64,
}

fn cache_path() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("KSEIndexViewer");
    fs::create_dir_all(&path).ok();
    path.push("portfolio.json");
    path
}

pub fn load_cache() -> Vec<Transaction> {
    let path = cache_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(txns) = serde_json::from_str::<Vec<Transaction>>(&content) {
                return txns;
            }
        }
    }
    Vec::new()
}

pub fn save_cache(txns: &[Transaction]) {
    let path = cache_path();
    if let Ok(json) = serde_json::to_string_pretty(txns) {
        fs::write(path, json).ok();
    }
}

/// Computes positions using the average-cost method.
/// BUY: cost_basis += shares*price; total_shares += shares; avg = cost_basis/total_shares
/// SELL: realized += (price - avg) * shares; total_shares -= shares; cost_basis -= avg*shares
/// Symbols where total_shares reaches 0 are still returned (so realized P&L stays visible).
pub fn compute_positions(txns: &[Transaction]) -> Vec<Position> {
    // (total_shares, cost_basis, realized)
    let mut by_symbol: HashMap<String, (f64, f64, f64)> = HashMap::new();

    for txn in txns {
        let symbol = txn.symbol.trim().to_uppercase();
        if symbol.is_empty() {
            continue;
        }
        let entry = by_symbol.entry(symbol).or_insert((0.0, 0.0, 0.0));
        let side = txn.side.trim().to_uppercase();
        if side == "BUY" {
            entry.0 += txn.shares;
            entry.1 += txn.shares * txn.price;
        } else if side == "SELL" {
            let avg = if entry.0 > 0.0 {
                entry.1 / entry.0
            } else {
                0.0
            };
            entry.2 += (txn.price - avg) * txn.shares;
            entry.0 -= txn.shares;
            entry.1 -= avg * txn.shares;
            if entry.0 < 1e-9 {
                entry.0 = 0.0;
            }
            if entry.1 < 1e-9 {
                entry.1 = 0.0;
            }
        }
    }

    let mut positions: Vec<Position> = by_symbol
        .into_iter()
        .map(|(symbol, (shares, cost, realized))| {
            let avg = if shares > 0.0 { cost / shares } else { 0.0 };
            Position {
                symbol,
                total_shares: shares,
                average_price: avg,
                realized_gain_loss: realized,
            }
        })
        .collect();

    // Symbols with active holdings first, then closed-out symbols (realized only)
    positions.sort_by(|a, b| {
        let a_active = a.total_shares > 0.0;
        let b_active = b.total_shares > 0.0;
        b_active.cmp(&a_active).then(a.symbol.cmp(&b.symbol))
    });
    positions
}

#[derive(Deserialize)]
struct GetResponse {
    ok: bool,
    transactions: Option<Vec<Transaction>>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct PostResponse {
    ok: bool,
    error: Option<String>,
}

pub async fn fetch_transactions(web_app_url: &str) -> Result<Vec<Transaction>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let text = client
        .get(web_app_url)
        .send()
        .await
        .map_err(|e| format!("network error: {}", e))?
        .text()
        .await
        .map_err(|e| format!("read error: {}", e))?;

    let parsed: GetResponse = serde_json::from_str(&text)
        .map_err(|e| format!("invalid response from sheet ({}): {}", e, truncate(&text, 200)))?;

    if !parsed.ok {
        return Err(parsed.error.unwrap_or_else(|| "unknown error from sheet".to_string()));
    }

    Ok(parsed.transactions.unwrap_or_default())
}

pub async fn post_transaction(web_app_url: &str, txn: &Transaction) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::to_string(txn).map_err(|e| e.to_string())?;

    // Apps Script's doPost reads e.postData.contents regardless of content-type.
    // Use text/plain to avoid any CORS-style quirks on the Google side.
    let text = client
        .post(web_app_url)
        .header("Content-Type", "text/plain;charset=utf-8")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("network error: {}", e))?
        .text()
        .await
        .map_err(|e| format!("read error: {}", e))?;

    let parsed: PostResponse = serde_json::from_str(&text)
        .map_err(|e| format!("invalid response from sheet ({}): {}", e, truncate(&text, 200)))?;

    if !parsed.ok {
        return Err(parsed.error.unwrap_or_else(|| "unknown error from sheet".to_string()));
    }
    Ok(())
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}

/// The Apps Script code we ask the user to paste into Extensions > Apps Script
/// of their own Google Sheet, then deploy as a Web App.
pub fn apps_script_setup_code() -> &'static str {
    r#"// KSE Index Viewer — Portfolio sync
// 1) Open a blank Google Sheet
// 2) Extensions > Apps Script, replace all code with this file, Save
// 3) Deploy > New deployment > Type: Web app
//    - Execute as: Me
//    - Who has access: Anyone
//    Click Deploy and copy the Web App URL into KSE Index Viewer Settings.

const SHEET_NAME = 'Transactions';

function ensureSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Date', 'Symbol', 'Side', 'Shares', 'Price']);
  }
  return sheet;
}

function doGet(e) {
  const sheet = ensureSheet_();
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1).map(function(r) {
    return {
      date: r[0] instanceof Date
        ? Utilities.formatDate(r[0], Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r[0]),
      symbol: String(r[1]).toUpperCase(),
      side: String(r[2]).toUpperCase(),
      shares: Number(r[3]),
      price: Number(r[4])
    };
  }).filter(function(r) {
    return r.symbol && !isNaN(r.shares) && !isNaN(r.price);
  });
  return ContentService.createTextOutput(JSON.stringify({ ok: true, transactions: rows }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = ensureSheet_();
    sheet.appendRow([
      data.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      String(data.symbol).toUpperCase(),
      String(data.side).toUpperCase(),
      Number(data.shares),
      Number(data.price)
    ]);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
"#
}
