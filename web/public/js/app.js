// Hash-based router + bootstrap for the KSE Index Viewer web app.

import { getSettings } from './store.js';
import { renderIndices } from './pages/indices.js';
import { renderMarket } from './pages/market.js';
import { renderPortfolio } from './pages/portfolio.js';
import { renderStock } from './pages/stock.js';
import { renderSettings } from './pages/settings.js';

const routes = [
  { pattern: /^#\/indices\/?$/,           render: renderIndices,   title: 'Indices',   nav: 'indices' },
  { pattern: /^#\/market\/?$/,            render: renderMarket,    title: 'Market',    nav: 'market' },
  { pattern: /^#\/portfolio\/?$/,         render: renderPortfolio, title: 'Portfolio', nav: 'portfolio' },
  { pattern: /^#\/stock\/([A-Z0-9]+)\/?$/i, render: renderStock,   title: 'Stock',     nav: null,
    extractParams: m => ({ symbol: m[1].toUpperCase() }) },
  { pattern: /^#\/settings\/?$/,          render: renderSettings,  title: 'Settings',  nav: 'settings' },
];

const pageEl  = document.getElementById('page');
const titleEl = document.getElementById('page-title');
const refreshBtn = document.getElementById('btn-refresh');
const primaryActionBtn = document.getElementById('btn-primary-action');

let currentRoute = null;
let currentRefreshHandler = null;
let currentPrimaryHandler = null;

/** Called by page modules to register a refresh handler for the header's ↻ button. */
export function onRefresh(handler) {
  currentRefreshHandler = handler;
}

/**
 * Register a contextual primary action button in the header (next to ↻ refresh).
 * Pages that don't call this get no button. Cleared automatically before each navigate.
 *
 *   onPrimaryAction(handler, { label: '+', title: 'Add Transaction' })
 */
export function onPrimaryAction(handler, { label = '+', title = 'Action', ariaLabel } = {}) {
  currentPrimaryHandler = handler;
  if (!handler) {
    primaryActionBtn.hidden = true;
    primaryActionBtn.textContent = '';
    return;
  }
  primaryActionBtn.textContent = label;
  primaryActionBtn.title = title;
  primaryActionBtn.setAttribute('aria-label', ariaLabel || title);
  primaryActionBtn.hidden = false;
}

function clearPrimaryAction() {
  currentPrimaryHandler = null;
  primaryActionBtn.hidden = true;
  primaryActionBtn.textContent = '';
}

function setActiveNav(nav) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === nav);
  });
}

async function navigate() {
  const hash = window.location.hash || defaultHash();
  for (const route of routes) {
    const m = hash.match(route.pattern);
    if (m) {
      currentRoute = route;
      currentRefreshHandler = null;
      clearPrimaryAction();
      titleEl.textContent = route.title;
      setActiveNav(route.nav);
      pageEl.innerHTML = '<div class="loading">Loading…</div>';
      try {
        const params = route.extractParams ? route.extractParams(m) : {};
        await route.render(pageEl, params);
      } catch (err) {
        console.error(err);
        pageEl.innerHTML = `<div class="error-state"><p>Something broke.</p><pre>${escapeHtml(err.message || String(err))}</pre></div>`;
      }
      return;
    }
  }
  window.location.hash = defaultHash();
}

function defaultHash() {
  const s = getSettings();
  const page = (s.default_page || 'indices').toLowerCase();
  return ['indices', 'market', 'portfolio', 'settings'].includes(page)
    ? `#/${page}`
    : '#/indices';
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

refreshBtn.addEventListener('click', () => {
  if (currentRefreshHandler) currentRefreshHandler();
  else navigate();
});

primaryActionBtn.addEventListener('click', () => {
  if (currentPrimaryHandler) currentPrimaryHandler();
});

window.addEventListener('hashchange', navigate);
window.addEventListener('load', navigate);
