use serde::{Deserialize, Serialize};
use scraper::{Html, Selector};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockQuote {
    pub symbol: String,
    pub current: f64,
    pub change: f64,
    pub percent_change: f64,
}

fn parse_decimal(raw: &str) -> f64 {
    let cleaned = raw
        .trim()
        .replace(',', "")
        .replace('%', "")
        .replace('(', "-")
        .replace(')', "");
    cleaned.parse::<f64>().unwrap_or(0.0)
}

/// Fetches the full PSX market-watch table in one HTTP request and returns
/// a map keyed by upper-case symbol. Columns are:
///   SYMBOL | SECTOR | LISTED IN | LDCP | OPEN | HIGH | LOW | CURRENT | CHANGE | CHANGE % | VOLUME
pub async fn fetch_market_watch() -> Result<HashMap<String, StockQuote>, Box<dyn std::error::Error + Send + Sync>> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(20))
        .build()?;

    let html = client
        .get("https://dps.psx.com.pk/market-watch")
        .send()
        .await?
        .text()
        .await?;

    let document = Html::parse_document(&html);
    let tr_sel = Selector::parse("table tr").unwrap();
    let td_sel = Selector::parse("td").unwrap();

    let mut map: HashMap<String, StockQuote> = HashMap::new();

    for row in document.select(&tr_sel) {
        let mut tds = row.select(&td_sel);
        let first_td = match tds.next() {
            Some(td) => td,
            None => continue,
        };

        // PSX appends badge <div>s like XD/XB/XR to the symbol cell. Reading
        // td.text() yields e.g. "AVNXD". Use the data-search attribute that
        // PSX sets on the cell — it contains just the clean symbol.
        let symbol = first_td
            .value()
            .attr("data-search")
            .map(|s| s.to_string())
            .unwrap_or_else(|| first_td.text().collect::<String>())
            .trim()
            .to_uppercase();
        if symbol.is_empty() || symbol == "SYMBOL" {
            continue;
        }

        // Remaining columns after the symbol cell:
        // [0] SECTOR | [1] LISTED IN | [2] LDCP | [3] OPEN | [4] HIGH |
        // [5] LOW | [6] CURRENT | [7] CHANGE | [8] CHANGE % | [9] VOLUME
        let rest: Vec<String> = tds
            .map(|td| td.text().collect::<String>().trim().to_string())
            .collect();
        if rest.len() < 9 {
            continue;
        }

        let current = parse_decimal(&rest[6]);
        if current == 0.0 {
            continue;
        }

        map.insert(
            symbol.clone(),
            StockQuote {
                symbol,
                current,
                change: parse_decimal(&rest[7]),
                percent_change: parse_decimal(&rest[8]),
            },
        );
    }

    Ok(map)
}
