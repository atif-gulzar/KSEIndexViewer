import { fetchPsx, jsonResponse, errorResponse } from './_psx.js';

// GET /api/symbols
// Proxies https://dps.psx.com.pk/symbols (JSON array of { symbol, name, sectorName, isETF, isDebt, isGEM }).
// Used for symbol autocomplete in the Add Transaction form.
// Cached for 6 hours since this rarely changes.
export async function onRequestGet() {
  try {
    const text = await fetchPsx('/symbols');
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return errorResponse('PSX /symbols did not return JSON', 502);
    }
    return jsonResponse({ ok: true, symbols: data }, { cacheSeconds: 21600 });
  } catch (err) {
    return errorResponse(`Failed to fetch PSX symbols: ${err.message}`, 502);
  }
}
