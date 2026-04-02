use serde::{Deserialize, Serialize};
use scraper::{Html, Selector};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexData {
    pub name: String,
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

pub async fn fetch_indices() -> Result<Vec<IndexData>, Box<dyn std::error::Error + Send + Sync>> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(15))
        .build()?;

    let html = client
        .get("https://dps.psx.com.pk/indices")
        .send()
        .await?
        .text()
        .await?;

    let document = Html::parse_document(&html);
    let table_sel = Selector::parse("table").unwrap();
    let tr_sel = Selector::parse("tr").unwrap();
    let td_sel = Selector::parse("td").unwrap();

    let table = document
        .select(&table_sel)
        .next()
        .ok_or("No table found")?;

    let mut results = Vec::new();

    for row in table.select(&tr_sel) {
        let cells: Vec<String> = row
            .select(&td_sel)
            .map(|td| td.text().collect::<String>())
            .collect();

        if cells.len() >= 6 {
            results.push(IndexData {
                name: cells[0].trim().to_string(),
                current: parse_decimal(&cells[3]),
                change: parse_decimal(&cells[4]),
                percent_change: parse_decimal(&cells[5]),
            });
        }
    }

    Ok(results)
}
