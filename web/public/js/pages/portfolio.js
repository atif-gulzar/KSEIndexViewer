import { fetchTransactions, postTransaction, fetchMarketWatch, computePositions, buildPortfolioRows } from '../api.js';
import { getSettings, getCache, setCache } from '../store.js';
import { escapeHtml, onRefresh, onPrimaryAction } from '../app.js';
import { formatSigned, formatMoney, formatSignedMoney, todayIsoDate } from '../format.js';

let summary = null;
let showAddForm = false;
let sortKey = 'symbol';
let sortDesc = false;

const SORT_OPTIONS = [
  { value: 'symbol',          label: 'Symbol',         defaultDesc: false },
  { value: 'unrealized',      label: 'Unrealized Rs',  defaultDesc: true  },
  { value: 'unrealized_pct',  label: 'Unrealized %',   defaultDesc: true  },
  { value: 'today',           label: "Today's Rs",     defaultDesc: true  },
  { value: 'today_pct',       label: "Today's %",      defaultDesc: true  },
  { value: 'worth',           label: 'Worth',          defaultDesc: true  },
];

export async function renderPortfolio(pageEl) {
  const settings = getSettings();
  if (!settings.apps_script_url || !settings.apps_script_url.trim()) {
    pageEl.innerHTML = emptyConfigView();
    return;
  }

  const refresh = async () => {
    pageEl.innerHTML = '<div class="loading">Loading portfolio…</div>';
    try {
      await loadPortfolio(true);   // force=true bypasses SW/browser cache
      paint(pageEl);
    } catch (e) {
      pageEl.innerHTML = `<div class="error-state">
        <p>Failed to load portfolio.</p>
        <pre>${escapeHtml(e.message)}</pre>
        <p><a href="#/settings">Check your Google Sheet URL in Settings.</a></p>
      </div>`;
    }
  };
  onRefresh(refresh);

  // Header "+" button toggles the Add Transaction form
  onPrimaryAction(() => {
    showAddForm = !showAddForm;
    paint(pageEl);
  }, { label: '+', title: 'Add Transaction' });

  // Render cached immediately if we have it, then refresh in background
  const cached = getCache('portfolio-summary');
  if (cached) {
    summary = cached;
    paint(pageEl);
    loadPortfolio().then(() => paint(pageEl)).catch(e => console.warn('Bg refresh failed:', e));
  } else {
    await refresh();
  }
}

async function loadPortfolio(force = false) {
  const [txns, marketData] = await Promise.all([
    fetchTransactions(force),
    fetchMarketWatch(force).catch(() => ({ stocks: [] })),
  ]);
  const quotesBySymbol = new Map((marketData.stocks || []).map(s => [s.symbol, s]));
  const positions = computePositions(txns);
  summary = buildPortfolioRows(positions, quotesBySymbol);
  setCache('portfolio-summary', summary);
  setCache('portfolio-txns', txns);
}

function paint(pageEl) {
  pageEl.innerHTML = view();
  bind(pageEl);
}

function emptyConfigView() {
  return `
    <div class="empty-config">
      <div class="empty-icon">📊</div>
      <h2>No Google Sheet connected</h2>
      <p>Track your PSX holdings with full ownership of your data. Paste your Apps Script Web App URL in Settings to get started — same URL the desktop app uses.</p>
      <a href="#/settings" class="btn-primary">Open Settings</a>
    </div>
  `;
}

function view() {
  const rows = sortedRows();
  const totalCls = summary.total_unrealized >= 0 ? 'positive' : 'negative';
  const realizedCls = summary.total_realized >= 0 ? 'positive' : 'negative';

  return `
    ${showAddForm ? addFormView() : ''}

    <div class="portfolio-summary">
      <div class="summary-row main">
        <span class="summary-label">Total Unrealized</span>
        <span class="summary-value ${totalCls}">
          ${formatSignedMoney(summary.total_unrealized)} (${formatSigned(summary.total_unrealized_pct, 2)}%)
        </span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Total Realized</span>
        <span class="summary-value ${realizedCls}">${formatSignedMoney(summary.total_realized)}</span>
      </div>
      <div class="summary-row faint">
        <span class="summary-label">Current Worth</span>
        <span class="summary-value">${formatMoney(summary.total_worth)}</span>
      </div>
    </div>

    ${rows.length > 0 ? `
      <div class="sort-bar">
        <span class="sort-label">Sort</span>
        <select id="portfolio-sort" class="sort-select">
          ${SORT_OPTIONS.map(o => `<option value="${o.value}" ${sortKey===o.value?'selected':''}>${o.label}</option>`).join('')}
        </select>
        <button id="portfolio-dir" class="sort-dir">${sortDesc ? '▼' : '▲'}</button>
      </div>
    ` : ''}

    <div class="holding-list">
      ${rows.length === 0
        ? '<div class="empty-state">No transactions yet. Tap the <strong>+</strong> in the header to add one.</div>'
        : rows.map(holdingCard).join('')}
    </div>
  `;
}

function holdingCard(r) {
  const todayCls = r.today_change_rs >= 0 ? 'positive' : 'negative';
  const unrealCls = r.unrealized_gain_loss >= 0 ? 'positive' : 'negative';
  const realCls = r.realized_gain_loss >= 0 ? 'positive' : 'negative';
  const isClosed = r.total_shares <= 0;
  return `
    <article class="holding-card ${isClosed ? 'closed' : ''}">
      <header class="holding-head">
        <a href="#/stock/${encodeURIComponent(r.symbol)}" class="holding-symbol">${escapeHtml(r.symbol)}</a>
        <span class="holding-today ${todayCls}">
          ${formatSignedMoney(r.today_change_rs)} (${formatSigned(r.today_change_pct, 2)}%)
        </span>
      </header>
      ${!isClosed ? `
        <div class="holding-meta-row">
          <span class="holding-meta">${r.total_shares} sh @ ${formatMoney(r.average_price)}</span>
          <span class="holding-meta">Worth: ${formatMoney(r.current_worth)}</span>
        </div>
        <div class="holding-pnl-row">
          <span class="${unrealCls}">Unrealized: ${formatSignedMoney(r.unrealized_gain_loss)} (${formatSigned(r.unrealized_pct, 2)}%)</span>
          ${r.realized_gain_loss !== 0 ? `<span class="${realCls}">Realized: ${formatSignedMoney(r.realized_gain_loss)}</span>` : ''}
        </div>
      ` : `
        <div class="holding-meta-row">
          <span class="holding-meta">Position closed</span>
          <span class="${realCls}">Realized: ${formatSignedMoney(r.realized_gain_loss)}</span>
        </div>
      `}
    </article>
  `;
}

function addFormView() {
  return `
    <form id="add-txn-form" class="add-txn-form">
      <header class="form-head">
        <span>Add Transaction</span>
        <button type="button" id="btn-cancel-txn" class="form-cancel" aria-label="Cancel">×</button>
      </header>
      <div class="form-row">
        <input id="txn-symbol" type="text" placeholder="Symbol (HBL)" maxlength="12" required autocomplete="off" autofocus>
        <select id="txn-side" required>
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
      </div>
      <div class="form-row">
        <input id="txn-shares" type="number" placeholder="Shares" step="any" min="0" required>
        <input id="txn-price" type="number" placeholder="Price" step="any" min="0" required>
      </div>
      <button type="submit" id="btn-submit-txn" class="btn-primary">Add</button>
      <div id="txn-error" class="form-error"></div>
    </form>
  `;
}

function sortedRows() {
  const active = summary.rows.filter(r => r.total_shares > 0);
  const closed = summary.rows.filter(r => r.total_shares <= 0);
  const key = (r) => {
    switch (sortKey) {
      case 'unrealized':     return r.unrealized_gain_loss;
      case 'unrealized_pct': return r.unrealized_pct;
      case 'today':          return r.today_change_rs;
      case 'today_pct':      return r.today_change_pct;
      case 'worth':          return r.current_worth;
      case 'symbol':
      default:               return r.symbol;
    }
  };
  const cmp = (a, b) => {
    const ka = key(a), kb = key(b);
    return typeof ka === 'string' ? ka.localeCompare(kb) : (ka - kb);
  };
  active.sort(cmp);
  closed.sort(cmp);
  if (sortDesc) { active.reverse(); closed.reverse(); }
  return [...active, ...closed];
}

function bind(pageEl) {
  pageEl.querySelector('#portfolio-sort')?.addEventListener('change', (e) => {
    const newKey = e.target.value;
    if (newKey !== sortKey) {
      const opt = SORT_OPTIONS.find(o => o.value === newKey);
      sortDesc = opt ? opt.defaultDesc : false;
    }
    sortKey = newKey;
    paint(pageEl);
  });
  pageEl.querySelector('#portfolio-dir')?.addEventListener('click', () => {
    sortDesc = !sortDesc;
    paint(pageEl);
  });
  pageEl.querySelector('#btn-cancel-txn')?.addEventListener('click', () => {
    showAddForm = false;
    paint(pageEl);
  });
  pageEl.querySelector('#add-txn-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = pageEl.querySelector('#txn-error');
    const btn = pageEl.querySelector('#btn-submit-txn');
    errorEl.textContent = '';

    const symbol = pageEl.querySelector('#txn-symbol').value.trim().toUpperCase();
    const side = pageEl.querySelector('#txn-side').value;
    const shares = parseFloat(pageEl.querySelector('#txn-shares').value);
    const price = parseFloat(pageEl.querySelector('#txn-price').value);

    if (!symbol || !isFinite(shares) || !isFinite(price) || shares <= 0 || price <= 0) {
      errorEl.textContent = 'Please fill all fields with positive values.';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const txn = { date: todayIsoDate(), symbol, side, shares, price };
      await postTransaction(txn);
      // Reload everything
      await loadPortfolio();
      showAddForm = false;
      paint(pageEl);
    } catch (err) {
      errorEl.textContent = String(err.message || err);
      btn.disabled = false;
      btn.textContent = 'Add';
    }
  });
}
