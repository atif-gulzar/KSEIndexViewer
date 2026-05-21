import { fetchStock } from '../api.js';
import { escapeHtml, onRefresh } from '../app.js';
import { formatSigned, formatMoney } from '../format.js';

export async function renderStock(pageEl, { symbol }) {
  const refresh = async () => {
    pageEl.innerHTML = `<div class="loading">Loading ${escapeHtml(symbol)}…</div>`;
    try {
      const data = await fetchStock(symbol);
      pageEl.innerHTML = view(data);
      renderChart(pageEl, data.intraday || []);
    } catch (e) {
      pageEl.innerHTML = `<div class="error-state">
        <p>Failed to load ${escapeHtml(symbol)}.</p>
        <pre>${escapeHtml(e.message)}</pre>
        <p><a href="#/market">← Back to market</a></p>
      </div>`;
    }
  };
  onRefresh(refresh);
  await refresh();
}

function view(data) {
  const q = data.quote || {};
  const last = q.current ?? lastFromIntraday(data.intraday);
  const change = q.change;
  const pct = q.percent_change;
  const cls = (change ?? 0) >= 0 ? 'positive' : 'negative';

  return `
    <div class="stock-header">
      <a href="#/market" class="back-link">← Market</a>
      <h2 class="stock-symbol">${escapeHtml(data.symbol)}</h2>
      ${q.name ? `<div class="stock-name">${escapeHtml(q.name)}</div>` : ''}
      <div class="stock-price-row">
        <span class="stock-price">${last != null ? formatMoney(last) : '—'}</span>
        ${change != null ? `<span class="stock-change ${cls}">${formatSigned(change, 2)} (${formatSigned(pct ?? 0, 2)}%)</span>` : ''}
      </div>
      <a class="stock-external" href="https://dps.psx.com.pk/company/${encodeURIComponent(data.symbol)}" target="_blank" rel="noopener">Open on dps.psx.com.pk ↗</a>
    </div>

    <div class="stock-chart" id="stock-chart" style="width:100%;height:280px;"></div>

    <dl class="stock-stats">
      ${row('LDCP', q.ldcp)}
      ${row('Open', q.open)}
      ${row('High', q.high)}
      ${row('Low', q.low)}
      ${row('Volume', q.volume, true)}
      ${row('52w High', q.week_high_52)}
      ${row('52w Low', q.week_low_52)}
    </dl>
  `;
}

function row(label, value, isVolume = false) {
  if (value == null || !isFinite(value)) return '';
  const fmt = isVolume
    ? value.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : formatMoney(value);
  return `<div class="stat-row"><dt>${label}</dt><dd>${fmt}</dd></div>`;
}

function lastFromIntraday(intraday) {
  if (!Array.isArray(intraday) || intraday.length === 0) return null;
  return intraday[intraday.length - 1][1];
}

function renderChart(pageEl, intraday) {
  const el = pageEl.querySelector('#stock-chart');
  if (!el) return;
  if (!Array.isArray(intraday) || intraday.length < 2) {
    el.innerHTML = '<div class="chart-empty">No intraday data available.</div>';
    return;
  }
  const xs = intraday.map(r => Number(r[0]));
  const ys = intraday.map(r => Number(r[1]));

  // Set color based on first vs. last
  const isUp = ys[ys.length - 1] >= ys[0];
  const stroke = isUp ? '#22c55e' : '#ef4444';

  const opts = {
    width: el.clientWidth || 350,
    height: 280,
    legend: { show: false },
    cursor: { drag: { x: false, y: false } },
    scales: { x: { time: true } },
    axes: [
      { stroke: '#94a3b8', grid: { stroke: 'rgba(148,163,184,0.1)' } },
      { stroke: '#94a3b8', grid: { stroke: 'rgba(148,163,184,0.1)' } },
    ],
    series: [
      {},
      { stroke, width: 2, fill: hexToRgba(stroke, 0.12) },
    ],
  };
  try {
    if (window.uPlot) {
      new window.uPlot(opts, [xs, ys], el);
    } else {
      el.innerHTML = '<div class="chart-empty">Chart library failed to load.</div>';
    }
  } catch (err) {
    console.warn('uPlot error:', err);
    el.innerHTML = '<div class="chart-empty">Chart failed to render.</div>';
  }

  // Redraw on resize
  let lastW = el.clientWidth;
  const ro = new ResizeObserver(() => {
    if (el.clientWidth !== lastW) {
      lastW = el.clientWidth;
      el.innerHTML = '';
      new window.uPlot({ ...opts, width: lastW }, [xs, ys], el);
    }
  });
  ro.observe(el);
}

function hexToRgba(hex, alpha) {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
