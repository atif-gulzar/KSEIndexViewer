// Shared PSX scraping helpers for Cloudflare Pages Functions.
// Each function in /api/*.js uses these to fetch and parse PSX HTML.

const PSX_BASE = 'https://dps.psx.com.pk';

const UA = 'Mozilla/5.0 (compatible; KSE-Index-Viewer-Web/1.0; +https://github.com/atif-gulzar/KSEIndexViewer)';

/** Fetch a PSX URL, returning text. Throws on non-200. */
export async function fetchPsx(path) {
  const url = path.startsWith('http') ? path : `${PSX_BASE}${path}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json' },
    cf: { cacheTtl: 30, cacheEverything: true },
  });
  if (!resp.ok) throw new Error(`PSX returned ${resp.status} for ${url}`);
  return await resp.text();
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
