import { fetchPsx, extractRows, parseDecimal, jsonResponse, errorResponse } from './_psx.js';

// GET /api/indices
// Scrapes https://dps.psx.com.pk/indices and returns an array of indices.
// Returns: { ok: true, indices: [{ name, current, change, percent_change }, ...] }
export async function onRequestGet() {
  try {
    const html = await fetchPsx('/indices');
    const rows = extractRows(html);

    const indices = [];
    for (const cells of rows) {
      // Columns observed: NAME | LDCP | OPEN | CURRENT | CHANGE | CHANGE % | ...
      // Matches the Rust scraper at scraper_service.rs: name=[0], current=[3], change=[4], pct=[5]
      if (cells.length < 6) continue;
      const name = cells[0].text.trim();
      if (!name || name.toUpperCase() === 'NAME') continue;
      indices.push({
        name,
        current: parseDecimal(cells[3].text),
        change: parseDecimal(cells[4].text),
        percent_change: parseDecimal(cells[5].text),
      });
    }

    if (indices.length === 0) {
      return errorResponse('No indices parsed from PSX response', 502);
    }

    return jsonResponse({ ok: true, indices, fetched_at: new Date().toISOString() }, { cacheSeconds: 30 });
  } catch (err) {
    return errorResponse(`Failed to fetch PSX indices: ${err.message}`, 502);
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
