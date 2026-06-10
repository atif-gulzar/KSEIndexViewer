import { fetchMarketWatch } from '../api.js';
import { escapeHtml, onRefresh } from '../app.js';
import { formatSigned, formatMoney } from '../format.js';

let lastData = null;
let query = '';
let sortKey = 'percent_change';
let sortDesc = true;

export async function renderMarket(pageEl) {
  const refresh = async (force = false) => {
    pageEl.innerHTML = '<div class="loading">Loading market…</div>';
    try {
      lastData = await fetchMarketWatch(force);
      paint(pageEl);
    } catch (e) {
      pageEl.innerHTML = `<div class="error-state"><p>Failed to load market.</p><pre>${escapeHtml(e.message)}</pre></div>`;
    }
  };
  onRefresh(() => refresh(true)); // explicit ↻ bypasses SW cache
  await refresh();
}

function paint(pageEl) {
  if (!lastData) return;
  const visible = filterAndSort(lastData.stocks);
  pageEl.innerHTML = view(lastData, visible);
  bind(pageEl);
}

function view(data, visible) {
  const fetched = data.fetched_at ? new Date(data.fetched_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
  const stale = data.stale ? '<span class="stale-pill">cached</span>' : '';

  return `
    <div class="page-meta">${stale} ${data.count || data.stocks.length} stocks · Updated ${fetched}</div>
    <input id="market-search" class="search-input" type="search" placeholder="Search symbol or sector…" value="${escapeHtml(query)}" autocomplete="off" />
    <div class="sort-bar">
      <span class="sort-label">Sort</span>
      <select id="market-sort" class="sort-select">
        <option value="percent_change" ${sortKey==='percent_change'?'selected':''}>% Change</option>
        <option value="change"         ${sortKey==='change'?'selected':''}>Change Rs</option>
        <option value="volume"         ${sortKey==='volume'?'selected':''}>Volume</option>
        <option value="current"        ${sortKey==='current'?'selected':''}>Current Price</option>
        <option value="symbol"         ${sortKey==='symbol'?'selected':''}>Symbol</option>
      </select>
      <button id="market-dir" class="sort-dir">${sortDesc ? '▼' : '▲'}</button>
    </div>
    <div class="market-list">
      ${visible.length === 0
        ? '<div class="empty-state">No stocks match your filter.</div>'
        : visible.map(s => {
            const cls = s.percent_change >= 0 ? 'positive' : 'negative';
            return `
              <a href="#/stock/${encodeURIComponent(s.symbol)}" class="market-row ${cls}">
                <div class="market-left">
                  <span class="market-symbol">${escapeHtml(s.symbol)}</span>
                  <span class="market-sector">${escapeHtml(s.listed_in || s.sector || '')}</span>
                </div>
                <div class="market-right">
                  <span class="market-price">${formatMoney(s.current)}</span>
                  <span class="market-change ${cls}">${formatSigned(s.change, 2)} (${formatSigned(s.percent_change, 2)}%)</span>
                </div>
              </a>
            `;
          }).join('')}
    </div>
  `;
}

function filterAndSort(stocks) {
  const q = query.trim().toUpperCase();
  let out = stocks;
  if (q) {
    out = out.filter(s =>
      s.symbol.toUpperCase().includes(q) ||
      (s.sector || '').toUpperCase().includes(q) ||
      (s.listed_in || '').toUpperCase().includes(q)
    );
  }
  out = out.slice();
  out.sort((a, b) => {
    const ka = a[sortKey];
    const kb = b[sortKey];
    if (typeof ka === 'string') return ka.localeCompare(kb);
    return (ka || 0) - (kb || 0);
  });
  if (sortDesc) out.reverse();
  return out;
}

function bind(pageEl) {
  const searchEl = pageEl.querySelector('#market-search');
  if (searchEl) {
    searchEl.addEventListener('input', (e) => {
      query = e.target.value;
      // Repaint without losing focus
      const visible = filterAndSort(lastData.stocks);
      const listEl = pageEl.querySelector('.market-list');
      if (listEl) {
        listEl.innerHTML = visible.length === 0
          ? '<div class="empty-state">No stocks match your filter.</div>'
          : visible.map(s => {
              const cls = s.percent_change >= 0 ? 'positive' : 'negative';
              return `
                <a href="#/stock/${encodeURIComponent(s.symbol)}" class="market-row ${cls}">
                  <div class="market-left">
                    <span class="market-symbol">${escapeHtml(s.symbol)}</span>
                    <span class="market-sector">${escapeHtml(s.listed_in || s.sector || '')}</span>
                  </div>
                  <div class="market-right">
                    <span class="market-price">${formatMoney(s.current)}</span>
                    <span class="market-change ${cls}">${formatSigned(s.change, 2)} (${formatSigned(s.percent_change, 2)}%)</span>
                  </div>
                </a>
              `;
            }).join('');
      }
    });
  }
  pageEl.querySelector('#market-sort')?.addEventListener('change', (e) => {
    if (sortKey !== e.target.value) {
      sortKey = e.target.value;
      sortDesc = sortKey !== 'symbol'; // symbol defaults A→Z
      paint(pageEl);
    }
  });
  pageEl.querySelector('#market-dir')?.addEventListener('click', () => {
    sortDesc = !sortDesc;
    paint(pageEl);
  });
}
