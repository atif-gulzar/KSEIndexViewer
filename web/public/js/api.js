// API wrapper. Two backends:
//   - Our /api/* Cloudflare Pages Functions (PSX scrape proxy)
//   - The user's Apps Script Web App URL (portfolio storage)

import { getSettings, getCache, setCache } from './store.js';

// ----- PSX (via our /api proxy) -----

async function getJSON(url, force = false) {
  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    cache: force ? 'reload' : 'default',
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`${url} → HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return await resp.json();
}

export async function fetchIndices(force = false) {
  const cached = getCache('indices');
  try {
    const data = await getJSON('/api/indices', force);
    if (data.ok && Array.isArray(data.indices)) {
      setCache('indices', data);
      return data;
    }
    throw new Error(data.error || 'bad payload');
  } catch (e) {
    if (cached) return { ...cached, stale: true };
    throw e;
  }
}

export async function fetchMarketWatch(force = false) {
  const cached = getCache('market');
  try {
    const data = await getJSON('/api/market-watch', force);
    if (data.ok && Array.isArray(data.stocks)) {
      setCache('market', data);
      return data;
    }
    throw new Error(data.error || 'bad payload');
  } catch (e) {
    if (cached) return { ...cached, stale: true };
    throw e;
  }
}

export async function fetchStock(symbol, force = false) {
  return await getJSON(`/api/stock/${encodeURIComponent(symbol)}`, force);
}

export async function fetchSymbols() {
  const cached = getCache('symbols');
  try {
    const data = await getJSON('/api/symbols');
    if (data.ok) {
      setCache('symbols', data);
      return data;
    }
    throw new Error(data.error || 'bad payload');
  } catch (e) {
    if (cached) return { ...cached, stale: true };
    throw e;
  }
}

// ----- Portfolio (via user's Apps Script Web App) -----

function appsScriptUrl() {
  const url = getSettings().apps_script_url;
  return url && url.trim() ? url.trim() : null;
}

export async function fetchTransactions(force = false) {
  const url = appsScriptUrl();
  if (!url) throw new Error('Portfolio Google Sheet URL not configured. Open Settings.');
  const resp = await fetch(url, { method: 'GET', cache: force ? 'reload' : 'default' });
  const text = await resp.text();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new Error(`Sheet returned non-JSON: ${text.slice(0, 200)}`); }
  if (!parsed.ok) throw new Error(parsed.error || 'Sheet returned ok:false');
  return parsed.transactions || [];
}

export async function postTransaction(txn) {
  const url = appsScriptUrl();
  if (!url) throw new Error('Portfolio Google Sheet URL not configured.');
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(txn),
  });
  const text = await resp.text();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new Error(`Sheet returned non-JSON: ${text.slice(0, 200)}`); }
  if (!parsed.ok) throw new Error(parsed.error || 'Sheet returned ok:false');
  return true;
}

// ----- Pure helpers (used by the portfolio page) -----

export function computePositions(transactions) {
  const bySym = new Map(); // symbol -> { shares, cost, realized }
  for (const t of transactions) {
    const sym = String(t.symbol || '').trim().toUpperCase();
    if (!sym) continue;
    const side = String(t.side || '').trim().toUpperCase();
    const shares = Number(t.shares) || 0;
    const price = Number(t.price) || 0;
    if (shares <= 0 || price <= 0) continue;

    if (!bySym.has(sym)) bySym.set(sym, { shares: 0, cost: 0, realized: 0 });
    const e = bySym.get(sym);
    if (side === 'BUY') {
      e.shares += shares;
      e.cost += shares * price;
    } else if (side === 'SELL') {
      const avg = e.shares > 0 ? e.cost / e.shares : 0;
      e.realized += (price - avg) * shares;
      e.shares -= shares;
      e.cost -= avg * shares;
      if (e.shares < 1e-9) e.shares = 0;
      if (e.cost   < 1e-9) e.cost = 0;
    }
  }
  const positions = [];
  for (const [symbol, { shares, cost, realized }] of bySym.entries()) {
    positions.push({
      symbol,
      total_shares: shares,
      average_price: shares > 0 ? cost / shares : 0,
      realized_gain_loss: realized,
    });
  }
  positions.sort((a, b) => {
    const ax = a.total_shares > 0 ? 0 : 1;
    const bx = b.total_shares > 0 ? 0 : 1;
    return ax - bx || a.symbol.localeCompare(b.symbol);
  });
  return positions;
}

export function buildPortfolioRows(positions, quotesBySymbol) {
  let total_unrealized = 0, total_realized = 0, total_worth = 0, total_cost = 0;
  const rows = positions.map(p => {
    const q = quotesBySymbol.get(p.symbol);
    const current_price = q ? q.current : 0;
    const today_change_rs = q ? q.change : 0;
    const today_change_pct = q ? q.percent_change : 0;
    const worth = p.total_shares * current_price;
    const cost = p.total_shares * p.average_price;
    const unreal = current_price > 0 ? (current_price - p.average_price) * p.total_shares : 0;
    const unreal_pct = cost > 0 ? (unreal / cost) * 100 : 0;
    total_unrealized += unreal;
    total_realized += p.realized_gain_loss;
    total_worth += worth;
    total_cost += cost;
    return {
      symbol: p.symbol,
      total_shares: p.total_shares,
      average_price: p.average_price,
      current_price,
      today_change_rs,
      today_change_pct,
      current_worth: worth,
      unrealized_gain_loss: unreal,
      unrealized_pct: unreal_pct,
      realized_gain_loss: p.realized_gain_loss,
    };
  });
  return {
    rows,
    total_unrealized,
    total_realized,
    total_worth,
    total_cost,
    total_unrealized_pct: total_cost > 0 ? (total_unrealized / total_cost) * 100 : 0,
  };
}
