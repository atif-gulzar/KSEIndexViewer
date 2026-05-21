const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow } = window.__TAURI__.window;
const { open } = window.__TAURI__.shell;

let allIndices = [];
let settings = {
  enabled_indices: ['KSE100', 'KSE30', 'KMI30', 'ALLSHR'],
  pinned_to_tray_index: 'KSE100',
  refresh_interval_seconds: 300,
  always_on_top: true,
  launch_at_startup: false,
  apps_script_url: null,
  default_tab: 'indices',
};

let currentView = 'widget';   // 'widget' | 'settings'
let currentTab = 'indices';   // 'indices' | 'portfolio'
let showAddTxnForm = false;
let portfolioSort = 'symbol';   // 'symbol' | 'unrealized' | 'unrealized_pct' | 'today' | 'today_pct' | 'worth'
let portfolioSortDesc = false;  // true = biggest first

const SORT_OPTIONS = [
  { value: 'symbol',         label: 'Symbol',         defaultDesc: false },
  { value: 'unrealized',     label: 'Unrealized Rs',  defaultDesc: true  },
  { value: 'unrealized_pct', label: 'Unrealized %',   defaultDesc: true  },
  { value: 'today',          label: "Today's Rs",     defaultDesc: true  },
  { value: 'today_pct',      label: "Today's %",      defaultDesc: true  },
  { value: 'worth',          label: 'Worth',          defaultDesc: true  },
];

function sortKey(row, sort) {
  switch (sort) {
    case 'unrealized':     return row.unrealized_gain_loss;
    case 'unrealized_pct': return row.unrealized_pct;
    case 'today':          return row.today_change_rs;
    case 'today_pct':      return row.today_change_pct;
    case 'worth':          return row.current_worth;
    case 'symbol':
    default:               return row.symbol;
  }
}

function sortedPortfolioRows() {
  // Always keep active positions above closed ones, regardless of sort.
  const active = portfolio.rows.filter(r => r.total_shares > 0);
  const closed = portfolio.rows.filter(r => r.total_shares <= 0);

  const cmp = (a, b) => {
    const ka = sortKey(a, portfolioSort);
    const kb = sortKey(b, portfolioSort);
    if (typeof ka === 'string') return ka.localeCompare(kb);
    return ka - kb;
  };

  active.sort(cmp);
  closed.sort(cmp);
  if (portfolioSortDesc) {
    active.reverse();
    closed.reverse();
  }
  return [...active, ...closed];
}
let portfolio = { rows: [], total_unrealized: 0, total_realized: 0, total_worth: 0, total_cost: 0, total_unrealized_pct: 0, configured: false };
let lastRefreshTime = null;
let countdownInterval = null;

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatMoney(n) {
  if (!isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1000) return sign + abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return sign + abs.toFixed(2);
}

function formatSigned(n, decimals = 2) {
  if (n === 0 || !isFinite(n)) return (0).toFixed(decimals);
  const sign = n > 0 ? '+' : '';
  return sign + n.toFixed(decimals);
}

function formatSignedMoney(n) {
  if (n === 0 || !isFinite(n)) return formatMoney(0);
  const sign = n > 0 ? '+' : '-';
  return sign + formatMoney(Math.abs(n));
}

function todayIsoDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ---- Tab bar (shared between Indices and Portfolio) ----
function tabBarHtml() {
  return `
    <div class="tab-bar">
      <button class="tab ${currentTab === 'indices' ? 'active' : ''}" data-tab="indices">Indices</button>
      <button class="tab ${currentTab === 'portfolio' ? 'active' : ''}" data-tab="portfolio">Portfolio</button>
    </div>
  `;
}

function bindTabBar() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === currentTab) return;
      currentTab = tab;
      renderWidget();
      if (currentTab === 'portfolio') {
        // Best-effort: trigger a backend refresh so quotes are fresh
        invoke('refresh_portfolio').catch(() => {});
      }
    });
  });
}

// ---- Indices view body ----
function indicesBodyHtml() {
  const enabledData = allIndices.filter(d => settings.enabled_indices.includes(d.name));
  return `
    <div class="index-list" id="index-list">
      ${enabledData.length === 0 ? '<div class="empty-state">No indices enabled.<br>Click &#9881; to configure.</div>' : ''}
      ${enabledData.map(d => {
        const isPositive = d.percent_change >= 0;
        const colorClass = isPositive ? 'positive' : 'negative';
        const sign = isPositive ? '+' : '';
        const isPinned = d.name === settings.pinned_to_tray_index;
        return `
          <div class="index-row ${colorClass}" data-name="${d.name}">
            <div class="index-name">
              ${isPinned ? '<span class="pin-icon" title="Pinned to tray">&#128204;</span>' : ''}
              ${d.name}
            </div>
            <div class="index-change">${sign}${d.percent_change.toFixed(2)}%</div>
          </div>
        `;
      }).join('')}
    </div>
    <div class="footer-links">
      <a href="#" id="link-source" title="Open PSX Indices page">Source</a>
      <a href="#" id="link-share" title="Share this app">Share</a>
    </div>
    <div class="statusbar" id="statusbar">
      <span id="last-updated">${lastRefreshTime ? `Updated ${formatTime(lastRefreshTime)}` : 'Loading...'}</span>
      <span id="countdown"></span>
    </div>
  `;
}

function bindIndicesBody() {
  document.getElementById('link-source')?.addEventListener('click', (e) => {
    e.preventDefault();
    open('https://dps.psx.com.pk/indices');
  });
  document.getElementById('link-share')?.addEventListener('click', (e) => {
    e.preventDefault();
    open('https://github.com/atif-gulzar/KSEIndexViewer/releases/latest');
  });

  // Right-click to pin to tray
  document.querySelectorAll('.index-row').forEach(row => {
    row.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      const name = row.dataset.name;
      if (name && name !== settings.pinned_to_tray_index) {
        settings.pinned_to_tray_index = name;
        await invoke('save_app_settings', { newSettings: settings });
        renderWidget();
      }
    });
  });

  startCountdown();
}

// ---- Portfolio view body ----
function portfolioBodyHtml() {
  if (!portfolio.configured) {
    return `
      <div class="portfolio-empty">
        <div class="empty-icon">&#128202;</div>
        <div class="empty-title">No Google Sheet connected</div>
        <div class="empty-hint">Open <strong>Settings</strong> &#9881; and paste your Apps Script Web App URL to start tracking holdings.</div>
        <button class="btn-link" id="btn-go-settings">Open Settings</button>
      </div>
    `;
  }

  const totalCls = portfolio.total_unrealized >= 0 ? 'positive' : 'negative';
  const realizedCls = portfolio.total_realized >= 0 ? 'positive' : 'negative';

  const rows = sortedPortfolioRows();
  const rowsHtml = rows.length === 0
    ? '<div class="empty-state">No transactions yet.<br>Use the form below to add one.</div>'
    : rows.map(r => {
        const todayCls = r.today_change_rs >= 0 ? 'positive' : 'negative';
        const unrealCls = r.unrealized_gain_loss >= 0 ? 'positive' : 'negative';
        const realCls = r.realized_gain_loss >= 0 ? 'positive' : 'negative';
        const isClosed = r.total_shares <= 0;
        return `
          <div class="holding-card ${isClosed ? 'closed' : ''}">
            <div class="holding-row1">
              <a href="#" class="holding-symbol" data-symbol="${r.symbol}" title="Open PSX page for ${r.symbol}">${r.symbol}</a>
              <span class="holding-today ${todayCls}">
                ${formatSignedMoney(r.today_change_rs)} (${formatSigned(r.today_change_pct, 2)}%)
              </span>
            </div>
            ${!isClosed ? `
              <div class="holding-row2">
                <span class="holding-meta">${r.total_shares} sh @ ${r.average_price.toFixed(2)}</span>
                <span class="holding-meta">Worth: ${formatMoney(r.current_worth)}</span>
              </div>
              <div class="holding-row3">
                <span class="holding-unreal ${unrealCls}">
                  Unrealized: ${formatSignedMoney(r.unrealized_gain_loss)}
                  (${formatSigned(r.unrealized_pct, 2)}%)
                </span>
                ${r.realized_gain_loss !== 0 ? `
                  <span class="holding-real ${realCls}">
                    Realized: ${formatSignedMoney(r.realized_gain_loss)}
                  </span>` : ''}
              </div>
            ` : `
              <div class="holding-row3">
                <span class="holding-meta">Position closed</span>
                <span class="holding-real ${realCls}">
                  Realized: ${formatSignedMoney(r.realized_gain_loss)}
                </span>
              </div>
            `}
          </div>
        `;
      }).join('');

  return `
    <div class="portfolio-summary">
      <div class="summary-row">
        <span class="summary-label">Total Unrealized</span>
        <span class="summary-value ${totalCls}">
          ${formatSignedMoney(portfolio.total_unrealized)}
          (${formatSigned(portfolio.total_unrealized_pct, 2)}%)
        </span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Total Realized</span>
        <span class="summary-value ${realizedCls}">
          ${formatSignedMoney(portfolio.total_realized)}
        </span>
      </div>
      <div class="summary-row faint">
        <span class="summary-label">Current Worth</span>
        <span class="summary-value">${formatMoney(portfolio.total_worth)}</span>
      </div>
    </div>
    ${rows.length > 0 ? `
      <div class="sort-bar">
        <span class="sort-label">Sort</span>
        <select id="sort-select" class="sort-select">
          ${SORT_OPTIONS.map(o => `
            <option value="${o.value}" ${portfolioSort === o.value ? 'selected' : ''}>${o.label}</option>
          `).join('')}
        </select>
        <button type="button" class="sort-dir" id="sort-dir" title="Toggle direction">
          ${portfolioSortDesc ? '&#9660;' : '&#9650;'}
        </button>
      </div>
    ` : ''}
    <div class="holding-list">${rowsHtml}</div>
    ${showAddTxnForm ? `
      <form class="add-txn-form" id="add-txn-form">
        <div class="form-title-row">
          <span class="form-title">Add Transaction</span>
          <button type="button" class="form-cancel" id="btn-cancel-txn" title="Cancel">&#10005;</button>
        </div>
        <div class="form-row">
          <input type="text" id="txn-symbol" placeholder="Symbol (e.g. HBL)" maxlength="12" required autofocus>
          <select id="txn-side" required>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
        </div>
        <div class="form-row">
          <input type="number" id="txn-shares" placeholder="Shares" step="any" min="0" required>
          <input type="number" id="txn-price" placeholder="Price" step="any" min="0" required>
        </div>
        <button type="submit" class="btn-save" id="btn-add-txn">Add</button>
        <div class="form-error" id="txn-error"></div>
      </form>
    ` : `
      <div class="add-txn-trigger">
        <button type="button" class="btn-add-txn-toggle" id="btn-show-txn">
          <span class="plus-icon">+</span> Add Transaction
        </button>
      </div>
    `}
  `;
}

function bindPortfolioBody() {
  document.getElementById('btn-go-settings')?.addEventListener('click', () => {
    currentView = 'settings';
    renderSettings();
  });

  document.getElementById('btn-show-txn')?.addEventListener('click', () => {
    showAddTxnForm = true;
    renderWidget();
  });

  document.getElementById('sort-select')?.addEventListener('change', (e) => {
    const newSort = e.target.value;
    // When the user picks a different metric, default to that metric's "natural" direction.
    if (newSort !== portfolioSort) {
      const opt = SORT_OPTIONS.find(o => o.value === newSort);
      portfolioSortDesc = opt ? opt.defaultDesc : false;
    }
    portfolioSort = newSort;
    renderWidget();
  });

  document.getElementById('sort-dir')?.addEventListener('click', () => {
    portfolioSortDesc = !portfolioSortDesc;
    renderWidget();
  });

  document.querySelectorAll('.holding-symbol').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const symbol = el.dataset.symbol;
      if (symbol) open(`https://dps.psx.com.pk/company/${encodeURIComponent(symbol)}`);
    });
  });

  document.getElementById('btn-cancel-txn')?.addEventListener('click', () => {
    showAddTxnForm = false;
    renderWidget();
  });

  const form = document.getElementById('add-txn-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const symbol = document.getElementById('txn-symbol').value.trim().toUpperCase();
    const side = document.getElementById('txn-side').value;
    const shares = parseFloat(document.getElementById('txn-shares').value);
    const price = parseFloat(document.getElementById('txn-price').value);
    const errorEl = document.getElementById('txn-error');
    errorEl.textContent = '';

    if (!symbol || !isFinite(shares) || !isFinite(price) || shares <= 0 || price <= 0) {
      errorEl.textContent = 'Please fill all fields with positive values.';
      return;
    }

    const btn = document.getElementById('btn-add-txn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const summary = await invoke('add_transaction', {
        symbol,
        side,
        shares,
        price,
        date: todayIsoDate(),
      });
      portfolio = summary;
      showAddTxnForm = false;
      renderWidget();
    } catch (err) {
      errorEl.textContent = String(err);
      btn.disabled = false;
      btn.textContent = 'Add';
    }
  });
}

// ---- Top-level widget render ----
function renderWidget() {
  const container = document.getElementById('app');
  const isPortfolio = currentTab === 'portfolio';

  container.innerHTML = `
    <div class="widget">
      <div class="titlebar" data-tauri-drag-region>
        <span class="title">${isPortfolio ? 'Portfolio' : 'PSX Indices'}</span>
        <div class="titlebar-buttons">
          <button class="btn-icon" id="btn-refresh" title="Refresh">&#8635;</button>
          <button class="btn-icon" id="btn-settings" title="Settings">&#9881;</button>
          <button class="btn-icon btn-close" id="btn-close" title="Hide to Tray">&#10005;</button>
        </div>
      </div>
      ${tabBarHtml()}
      <div class="tab-content">
        ${isPortfolio ? portfolioBodyHtml() : indicesBodyHtml()}
      </div>
    </div>
  `;

  // Shared bindings
  document.getElementById('btn-refresh')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh');
    btn.classList.add('spinning');
    try {
      if (currentTab === 'portfolio') {
        const summary = await invoke('refresh_portfolio');
        portfolio = summary;
      } else {
        const data = await invoke('refresh_data');
        allIndices = data;
      }
      lastRefreshTime = new Date();
      renderWidget();
    } catch (e) {
      console.error(e);
    }
    btn?.classList.remove('spinning');
  });

  document.getElementById('btn-settings')?.addEventListener('click', () => {
    currentView = 'settings';
    renderSettings();
  });

  document.getElementById('btn-close')?.addEventListener('click', () => {
    getCurrentWindow().hide();
  });

  bindTabBar();
  if (isPortfolio) bindPortfolioBody();
  else bindIndicesBody();
}

// ---- Settings view ----
function renderSettings() {
  const container = document.getElementById('app');

  const knownIndices = allIndices.length > 0
    ? allIndices.map(d => d.name)
    : ['KSE100', 'KSE100PR', 'ALLSHR', 'KSE30', 'KMI30', 'BKTI', 'OGTI', 'KMIALLSHR',
       'PSXDIV20', 'UPP9', 'NITPGI', 'NBPPGI', 'MZNPI', 'JSMFI', 'ACI', 'JSGBKTI', 'HBLTTI', 'MII30'];

  container.innerHTML = `
    <div class="widget">
      <div class="titlebar" data-tauri-drag-region>
        <button class="btn-icon" id="btn-back" title="Back">&#8592;</button>
        <span class="title">Settings</span>
        <div class="titlebar-buttons">
          <button class="btn-icon btn-close" id="btn-close" title="Hide to Tray">&#10005;</button>
        </div>
      </div>
      <div class="settings-content">
        <div class="settings-section">
          <div class="section-label">Visible Indices</div>
          <div class="section-hint">Right-click an index in the widget to pin it to tray</div>
          <div class="index-checkboxes" id="index-checkboxes">
            ${knownIndices.map(name => {
              const checked = settings.enabled_indices.includes(name) ? 'checked' : '';
              const isPinned = name === settings.pinned_to_tray_index;
              return `
                <label class="checkbox-row ${isPinned ? 'pinned' : ''}">
                  <input type="checkbox" value="${name}" ${checked}>
                  <span class="checkbox-name">${name}</span>
                  ${isPinned ? '<span class="pin-badge">TRAY</span>' : ''}
                </label>
              `;
            }).join('')}
          </div>
        </div>
        <div class="settings-section">
          <div class="section-label">Tray Index</div>
          <select id="tray-select" class="settings-select">
            ${knownIndices.map(name => {
              const selected = name === settings.pinned_to_tray_index ? 'selected' : '';
              return `<option value="${name}" ${selected}>${name}</option>`;
            }).join('')}
          </select>
        </div>
        <div class="settings-section">
          <div class="section-label">Refresh Interval</div>
          <select id="refresh-select" class="settings-select">
            <option value="60" ${settings.refresh_interval_seconds === 60 ? 'selected' : ''}>1 minute</option>
            <option value="120" ${settings.refresh_interval_seconds === 120 ? 'selected' : ''}>2 minutes</option>
            <option value="300" ${settings.refresh_interval_seconds === 300 ? 'selected' : ''}>5 minutes</option>
            <option value="600" ${settings.refresh_interval_seconds === 600 ? 'selected' : ''}>10 minutes</option>
          </select>
        </div>
        <div class="settings-section">
          <div class="section-label">Default Tab</div>
          <select id="default-tab-select" class="settings-select">
            <option value="indices" ${settings.default_tab === 'indices' ? 'selected' : ''}>Indices</option>
            <option value="portfolio" ${settings.default_tab === 'portfolio' ? 'selected' : ''}>Portfolio</option>
          </select>
        </div>
        <div class="settings-section">
          <label class="checkbox-row">
            <input type="checkbox" id="ontop-checkbox" ${settings.always_on_top ? 'checked' : ''}>
            <span class="checkbox-name">Always on top</span>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" id="startup-checkbox" ${settings.launch_at_startup ? 'checked' : ''}>
            <span class="checkbox-name">Launch at Windows startup</span>
          </label>
        </div>
        <div class="settings-section">
          <div class="section-label">Portfolio Google Sheet</div>
          <div class="section-hint">Deploy the Apps Script and paste the Web App URL here</div>
          <input type="text" id="apps-script-url" class="settings-input"
            placeholder="https://script.google.com/macros/s/.../exec"
            value="${settings.apps_script_url ? escapeHtml(settings.apps_script_url) : ''}">
          <div class="sheet-help-row">
            <button type="button" class="btn-link" id="btn-copy-script">&#128203; Copy Apps Script code</button>
            <span id="copy-status" class="copy-status"></span>
          </div>
          <details class="sheet-setup-help">
            <summary>How to set up (one time)</summary>
            <ol>
              <li>Create a new blank Google Sheet</li>
              <li>In the Sheet's <strong>top menu bar</strong>, click <strong>Extensions &rarr; Apps Script</strong> &mdash; opens the script editor in a new tab</li>
              <li>Click <em>Copy Apps Script code</em> above and paste it into the editor (replace all), then Save</li>
              <li>Top-right of the editor: click <strong>Deploy &rarr; New deployment</strong>. In the dialog, click the &#9881; next to <em>Select type</em> and pick <strong>Web app</strong>. Set <em>Execute as</em>: <strong>Me</strong>, <em>Who has access</em>: <strong>Anyone</strong>, then click <strong>Deploy</strong></li>
              <li>Authorize when prompted &middot; copy the <strong>Web app URL</strong> &middot; paste it above</li>
            </ol>
          </details>
        </div>
        <button class="btn-save" id="btn-save">Save Settings</button>
      </div>
    </div>
  `;

  document.getElementById('btn-back')?.addEventListener('click', () => {
    currentView = 'widget';
    renderWidget();
  });

  document.getElementById('btn-close')?.addEventListener('click', () => {
    getCurrentWindow().hide();
  });

  document.getElementById('btn-copy-script')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('copy-status');
    try {
      const code = await invoke('get_apps_script_code');
      await navigator.clipboard.writeText(code);
      statusEl.textContent = 'Copied!';
      setTimeout(() => { statusEl.textContent = ''; }, 2500);
    } catch (e) {
      statusEl.textContent = 'Copy failed';
      console.error(e);
    }
  });

  document.getElementById('btn-save')?.addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll('#index-checkboxes input[type="checkbox"]');
    const enabled = [];
    checkboxes.forEach(cb => {
      if (cb.checked) enabled.push(cb.value);
    });

    const traySelect = document.getElementById('tray-select');
    const refreshSelect = document.getElementById('refresh-select');
    const ontopCheckbox = document.getElementById('ontop-checkbox');
    const startupCheckbox = document.getElementById('startup-checkbox');
    const sheetUrlInput = document.getElementById('apps-script-url');
    const defaultTabSelect = document.getElementById('default-tab-select');

    settings.enabled_indices = enabled;
    settings.pinned_to_tray_index = traySelect.value;
    settings.refresh_interval_seconds = parseInt(refreshSelect.value, 10);
    settings.always_on_top = ontopCheckbox.checked;
    settings.launch_at_startup = startupCheckbox.checked;
    settings.default_tab = defaultTabSelect.value;
    const newUrl = sheetUrlInput.value.trim();
    settings.apps_script_url = newUrl.length > 0 ? newUrl : null;

    await invoke('save_app_settings', { newSettings: settings });
    await invoke('set_always_on_top', { onTop: settings.always_on_top });

    // If the sheet URL is now set, pull transactions immediately
    if (settings.apps_script_url) {
      try {
        portfolio = await invoke('refresh_portfolio');
      } catch (e) {
        console.error('Portfolio refresh after save failed:', e);
      }
    }

    currentView = 'widget';
    renderWidget();
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function startCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);

  countdownInterval = setInterval(() => {
    const el = document.getElementById('countdown');
    if (!el || !lastRefreshTime) return;

    const elapsed = (Date.now() - lastRefreshTime.getTime()) / 1000;
    const remaining = Math.max(0, settings.refresh_interval_seconds - elapsed);
    const mins = Math.floor(remaining / 60);
    const secs = Math.floor(remaining % 60);
    el.textContent = `Next: ${mins}:${secs.toString().padStart(2, '0')}`;
  }, 1000);
}

async function init() {
  settings = await invoke('get_settings');

  // Apply default-tab preference (falls back to 'indices' if invalid)
  if (settings.default_tab === 'portfolio') {
    currentTab = 'portfolio';
  }

  // Pull cached portfolio immediately so the tab renders without flicker
  try {
    portfolio = await invoke('get_portfolio');
  } catch (e) {
    console.error('Initial portfolio load failed:', e);
  }

  renderWidget();

  // Initial data fetch
  try {
    const data = await invoke('refresh_data');
    allIndices = data;
    lastRefreshTime = new Date();
    renderWidget();
  } catch (e) {
    console.error('Initial fetch failed:', e);
  }

  // Fetch fresh portfolio in the background (uses sheet if configured)
  invoke('refresh_portfolio').then(summary => {
    portfolio = summary;
    if (currentView === 'widget' && currentTab === 'portfolio') {
      renderWidget();
    }
  }).catch(e => console.error('Initial portfolio refresh failed:', e));

  // Listen for data updates from auto-refresh
  await listen('data-updated', (event) => {
    allIndices = event.payload;
    lastRefreshTime = new Date();
    if (currentView === 'widget' && currentTab === 'indices') {
      renderWidget();
    }
  });

  // Portfolio updates from auto-refresh / add-transaction
  await listen('portfolio-updated', (event) => {
    portfolio = event.payload;
    if (currentView === 'widget' && currentTab === 'portfolio') {
      renderWidget();
    }
  });

  await listen('portfolio-error', (event) => {
    console.warn('Portfolio sync error:', event.payload);
  });

  // Listen for show-settings from tray
  await listen('show-settings', () => {
    currentView = 'settings';
    renderSettings();
  });

  // Listen for trigger-refresh from tray
  await listen('trigger-refresh', async () => {
    try {
      const data = await invoke('refresh_data');
      allIndices = data;
      lastRefreshTime = new Date();
      if (currentView === 'widget') {
        renderWidget();
      }
    } catch (e) {
      console.error(e);
    }
  });
}

init();
