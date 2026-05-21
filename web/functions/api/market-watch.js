import { fetchPsx, extractRows, parseDecimal, jsonResponse, errorResponse } from './_psx.js';

// GET /api/market-watch
// Scrapes https://dps.psx.com.pk/market-watch — the full ~700-row PSX table.
// Returns: { ok: true, stocks: [{ symbol, sector, listed_in, ldcp, open, high, low, current, change, percent_change, volume }, ...] }
//
// Note: Reads the symbol from the `data-search` attribute on the first <td>,
// NOT from td.text(). PSX appends badges like <div class="tag tag--xd">XD</div>
// to the symbol cell for ex-dividend/ex-bonus/ex-rights stocks — reading text()
// would yield e.g. "AVNXD" instead of "AVN".
export async function onRequestGet() {
  try {
    const html = await fetchPsx('/market-watch');
    const rows = extractRows(html);

    const stocks = [];
    for (const cells of rows) {
      if (cells.length < 10) continue;

      // First cell carries the symbol — prefer data-search attribute over text content.
      const symbol = (cells[0].dataSearch || cells[0].text || '').trim().toUpperCase();
      if (!symbol || symbol === 'SYMBOL') continue;

      // Cell index layout (post-symbol):
      // [1] SECTOR | [2] LISTED IN | [3] LDCP | [4] OPEN |
      // [5] HIGH   | [6] LOW       | [7] CURRENT | [8] CHANGE | [9] CHANGE % | [10] VOLUME
      const current = parseDecimal(cells[7].text);
      if (current === 0) continue;

      stocks.push({
        symbol,
        sector: cells[1].text,
        listed_in: cells[2].text,
        ldcp: parseDecimal(cells[3].text),
        open: parseDecimal(cells[4].text),
        high: parseDecimal(cells[5].text),
        low: parseDecimal(cells[6].text),
        current,
        change: parseDecimal(cells[8].text),
        percent_change: parseDecimal(cells[9].text),
        volume: parseDecimal(cells[10] ? cells[10].text : '0'),
      });
    }

    if (stocks.length === 0) {
      return errorResponse('No stocks parsed from PSX market-watch', 502);
    }

    return jsonResponse(
      { ok: true, stocks, count: stocks.length, fetched_at: new Date().toISOString() },
      { cacheSeconds: 30 }
    );
  } catch (err) {
    return errorResponse(`Failed to fetch PSX market-watch: ${err.message}`, 502);
  }
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  });
}
