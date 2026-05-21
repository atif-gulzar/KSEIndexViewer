import { fetchPsx, parseDecimal, jsonResponse, errorResponse } from '../_psx.js';

// GET /api/stock/:symbol
// Fetches both:
//   - https://dps.psx.com.pk/company/<SYMBOL> for static quote info
//   - https://dps.psx.com.pk/timeseries/int/<SYMBOL> for intraday tick data
// Returns: { ok: true, quote: {...}, intraday: [[ts, price, vol], ...] }

export async function onRequestGet(context) {
  const symbol = String(context.params.symbol || '').trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9]{1,12}$/.test(symbol)) {
    return errorResponse('Invalid symbol', 400);
  }

  try {
    const [companyHtml, intradayText] = await Promise.all([
      fetchPsx(`/company/${encodeURIComponent(symbol)}`).catch(() => null),
      fetchPsx(`/timeseries/int/${encodeURIComponent(symbol)}`).catch(() => null),
    ]);

    let intraday = [];
    if (intradayText) {
      try {
        const parsed = JSON.parse(intradayText);
        if (parsed && Array.isArray(parsed.data)) {
          // Each row is [unix_ts, price, volume], newest first. Reverse to chronological.
          intraday = parsed.data.slice().reverse();
        }
      } catch (e) {
        // ignore; intraday stays empty
      }
    }

    const quote = companyHtml ? parseCompanyPage(companyHtml, symbol) : null;
    if (!quote && intraday.length === 0) {
      return errorResponse(`No data for ${symbol}`, 404);
    }

    return jsonResponse(
      { ok: true, symbol, quote, intraday, fetched_at: new Date().toISOString() },
      { cacheSeconds: 30 }
    );
  } catch (err) {
    return errorResponse(`Failed to fetch ${symbol}: ${err.message}`, 502);
  }
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
}

// --- Helpers ---

/** Pull key/value pairs out of the company page. PSX renders quote info as a
 *  series of stats blocks; we use a permissive label-to-value extraction. */
function parseCompanyPage(html, symbol) {
  const out = { symbol };

  // Company full name from <title>. Title is e.g.
  // "HBL - Stock quote for Habib Bank Limited - Pakistan Stock Exchange (PSX)"
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    const raw = titleMatch[1].trim();
    const nameMatch = raw.match(/Stock quote for\s+(.+?)\s+-\s+Pakistan Stock Exchange/i);
    if (nameMatch) {
      out.name = nameMatch[1].trim();
    } else {
      // Fallback: strip common suffixes
      out.name = raw
        .replace(/^.+?\s*-\s*Stock quote for\s*/i, '')
        .replace(/\s*-\s*Pakistan Stock Exchange.*$/i, '')
        .replace(/\s*\|\s*PSX.*$/i, '')
        .trim();
    }
  }

  // Current price block — usually a large number near the top.
  // Match the first <div class="quote__close"> ... </div> or similar.
  const lastMatch =
    html.match(/class="quote__close"[^>]*>\s*([\d.,]+)/i) ||
    html.match(/class="last"[^>]*>\s*([\d.,]+)/i);
  if (lastMatch) out.current = parseDecimal(lastMatch[1]);

  // Change Rs + change %
  const changeMatch = html.match(/quote__change[^"]*"[^>]*>([^<]+)</i);
  if (changeMatch) out.change = parseDecimal(changeMatch[1]);
  const pctMatch = html.match(/quote__percent[^"]*"[^>]*>([^<]+)</i);
  if (pctMatch) out.percent_change = parseDecimal(pctMatch[1]);

  // Stat labels — generic key/value scan. PSX uses <div class="stats-item">…</div>.
  // We grep for common labels and pull the next numeric value.
  const labels = {
    ldcp: /LDCP[^<]*<[^>]+>\s*([\d.,]+)/i,
    open: />\s*Open\s*<[^>]+>\s*([\d.,]+)/i,
    high: />\s*High\s*<[^>]+>\s*([\d.,]+)/i,
    low: />\s*Low\s*<[^>]+>\s*([\d.,]+)/i,
    volume: />\s*Volume\s*<[^>]+>\s*([\d.,]+)/i,
    week_high_52: /52[^A-Za-z]+Week[^A-Za-z]+High[^<]*<[^>]+>\s*([\d.,]+)/i,
    week_low_52: /52[^A-Za-z]+Week[^A-Za-z]+Low[^<]*<[^>]+>\s*([\d.,]+)/i,
  };
  for (const [key, re] of Object.entries(labels)) {
    const m = html.match(re);
    if (m) out[key] = parseDecimal(m[1]);
  }

  return out;
}
