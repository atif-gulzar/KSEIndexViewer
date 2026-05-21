import { fetchIndices } from '../api.js';
import { escapeHtml, onRefresh } from '../app.js';
import { formatSigned } from '../format.js';

export async function renderIndices(pageEl) {
  const refresh = async () => {
    pageEl.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const data = await fetchIndices();
      pageEl.innerHTML = view(data);
    } catch (e) {
      pageEl.innerHTML = `<div class="error-state"><p>Failed to load indices.</p><pre>${escapeHtml(e.message)}</pre></div>`;
    }
  };
  onRefresh(refresh);
  await refresh();
}

function view(data) {
  const fetched = data.fetched_at ? new Date(data.fetched_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
  const stale = data.stale ? '<span class="stale-pill">cached</span>' : '';
  return `
    <div class="page-meta">${stale} Updated ${fetched}</div>
    <div class="card-list">
      ${data.indices.map(i => {
        const cls = i.percent_change >= 0 ? 'positive' : 'negative';
        return `
          <article class="index-card ${cls}">
            <div class="index-name">${escapeHtml(i.name)}</div>
            <div class="index-current">${formatMoney(i.current)}</div>
            <div class="index-change ${cls}">
              ${formatSigned(i.change, 2)} (${formatSigned(i.percent_change, 2)}%)
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function formatMoney(n) {
  if (!isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}
