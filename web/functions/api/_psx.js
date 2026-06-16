// Shared PSX scraping helpers for Cloudflare Pages Functions.
// Each function in /api/*.js uses these to fetch and parse PSX HTML.

const PSX_BASE = 'https://dps.psx.com.pk';

// Mimic a real Chrome navigation. PSX's WAF returns a non-standard 462 to
// requests that look automated — a bot User-Agent or a sparse header set —
// especially from datacenter IPs like Cloudflare's. The desktop app sends a
// browser User-Agent and is never blocked; from a datacenter IP we need the
// FULL browser header set (Sec-Fetch-*, sec-ch-ua, Accept-Language, Referer)
// to clear the heuristic. A bare UA+Accept (what we sent before) trips it.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://dps.psx.com.pk/',
  'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

// Statuses worth a retry: PSX's 462 WAF rejection plus transient gateway/rate codes.
const RETRYABLE_STATUS = new Set([429, 462, 500, 502, 503, 504, 520, 521, 522, 524]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch a PSX URL, returning text. Retries transient WAF rejections (462 etc.)
 * with a short backoff. Throws with the last status/error on final failure.
 */
export async function fetchPsx(path, { retries = 2 } = {}) {
  const url = path.startsWith('http') ? path : `${PSX_BASE}${path}`;
  let lastStatus = 0;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: BROWSER_HEADERS,
        redirect: 'follow',
        // Cache only successful PSX responses at the edge; never cache a 462/5xx
        // (else a single rejection would be replayed to everyone for the TTL window).
        cf: { cacheTtlByStatus: { '200-299': 30, '400-599': 0 }, cacheEverything: true },
      });
      if (resp.ok) return await resp.text();
      lastStatus = resp.status;
      if (!RETRYABLE_STATUS.has(resp.status)) break;
    } catch (e) {
      lastErr = e; // network/transient error — fall through to retry
    }
    if (attempt < retries) await sleep(250 * (attempt + 1));
  }
  throw new Error(
    lastErr ? `fetch failed for ${url}: ${lastErr.message}` : `PSX returned ${lastStatus} for ${url}`
  );
}

/** Strip HTML tags and collapse whitespace. */
function textOf(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse `<tr>...<td>...</td>...</tr>` blocks from a chunk of HTML.
 * Returns an array of rows; each row is an array of { text, attrs, dataSearch }.
 * Robust enough for PSX tables; ignores nested tables (PSX doesn't nest).
 */
export function extractRows(html) {
  const rows = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRe = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(html)) !== null) {
    const inner = trMatch[1];
    const cells = [];
    let tdMatch;
    tdRe.lastIndex = 0;
    while ((tdMatch = tdRe.exec(inner)) !== null) {
      const attrs = tdMatch[1] || '';
      const text = textOf(tdMatch[2]);
      const ds = attrs.match(/data-search\s*=\s*"([^"]+)"/i);
      const dor = attrs.match(/data-order\s*=\s*"([^"]+)"/i);
      cells.push({
        text,
        attrs,
        dataSearch: ds ? ds[1] : null,
        dataOrder: dor ? dor[1] : null,
      });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/** Parse a numeric string with commas/percent/parens. Returns 0 if not parseable. */
export function parseDecimal(raw) {
  if (raw == null) return 0;
  const cleaned = String(raw)
    .trim()
    .replace(/,/g, '')
    .replace(/%/g, '')
    .replace(/\(/g, '-')
    .replace(/\)/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Standard JSON response with CORS + short cache. */
export function jsonResponse(body, { status = 200, cacheSeconds = 30 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
    },
  });
}

export function errorResponse(message, status = 502) {
  return jsonResponse({ ok: false, error: message }, { status, cacheSeconds: 0 });
}
