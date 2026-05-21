import { getSettings, saveSettings, clearCache } from '../store.js';
import { escapeHtml } from '../app.js';

const APPS_SCRIPT_CODE = `// KSE Index Viewer — Portfolio sync
const SHEET_NAME = 'Transactions';

function ensureSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Date', 'Symbol', 'Side', 'Shares', 'Price']);
  }
  return sheet;
}

function doGet(e) {
  const sheet = ensureSheet_();
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1).map(function(r) {
    return {
      date: r[0] instanceof Date
        ? Utilities.formatDate(r[0], Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r[0]),
      symbol: String(r[1]).toUpperCase(),
      side: String(r[2]).toUpperCase(),
      shares: Number(r[3]),
      price: Number(r[4])
    };
  }).filter(function(r) {
    return r.symbol && !isNaN(r.shares) && !isNaN(r.price);
  });
  return ContentService.createTextOutput(JSON.stringify({ ok: true, transactions: rows }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = ensureSheet_();
    sheet.appendRow([
      data.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      String(data.symbol).toUpperCase(),
      String(data.side).toUpperCase(),
      Number(data.shares),
      Number(data.price)
    ]);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
`;

export async function renderSettings(pageEl) {
  const settings = getSettings();
  pageEl.innerHTML = view(settings);
  bind(pageEl, settings);
}

function view(s) {
  return `
    <form id="settings-form" class="settings-form">
      <section class="settings-section">
        <label class="field-label" for="apps-script-url">Portfolio Google Sheet</label>
        <p class="field-hint">Paste your Apps Script Web App URL (same one the desktop uses).</p>
        <input id="apps-script-url" type="url" placeholder="https://script.google.com/macros/s/.../exec"
               value="${escapeHtml(s.apps_script_url || '')}" />
        <div class="help-row">
          <button type="button" id="btn-copy-script" class="btn-link">📋 Copy Apps Script code</button>
          <span id="copy-status" class="copy-status"></span>
        </div>
        <details>
          <summary>How to set up (one time)</summary>
          <ol>
            <li>Create a blank Google Sheet</li>
            <li>In the Sheet's <strong>top menu bar</strong>, click <strong>Extensions → Apps Script</strong> — opens the script editor in a new tab</li>
            <li>Click <em>Copy Apps Script code</em> above, paste into the editor (replace all), Save (Ctrl/Cmd + S)</li>
            <li>Top-right of the editor: click <strong>Deploy → New deployment</strong>. In the dialog, click the ⚙ next to <em>Select type</em> and pick <strong>Web app</strong>. Set <em>Execute as</em>: <strong>Me</strong>, <em>Who has access</em>: <strong>Anyone</strong>, then click <strong>Deploy</strong></li>
            <li>Authorize the script when prompted · copy the <strong>Web app URL</strong> Google gives you · paste it above</li>
          </ol>
        </details>
      </section>

      <section class="settings-section">
        <label class="field-label" for="default-page">Default Page</label>
        <select id="default-page">
          <option value="indices"   ${s.default_page === 'indices' ? 'selected' : ''}>Indices</option>
          <option value="market"    ${s.default_page === 'market' ? 'selected' : ''}>Market</option>
          <option value="portfolio" ${s.default_page === 'portfolio' ? 'selected' : ''}>Portfolio</option>
        </select>
      </section>

      <section class="settings-section">
        <label class="field-label" for="refresh-interval">Refresh Interval</label>
        <select id="refresh-interval">
          <option value="30"  ${s.refresh_interval_seconds === 30 ? 'selected' : ''}>30 seconds</option>
          <option value="60"  ${s.refresh_interval_seconds === 60 ? 'selected' : ''}>1 minute</option>
          <option value="300" ${s.refresh_interval_seconds === 300 ? 'selected' : ''}>5 minutes</option>
        </select>
      </section>

      <button type="submit" class="btn-primary">Save Settings</button>
      <button type="button" id="btn-clear-cache" class="btn-secondary">Clear Cache</button>

      <section class="settings-section about">
        <p class="about-text">KSE Index Viewer — Web · <a href="https://github.com/atif-gulzar/KSEIndexViewer" target="_blank" rel="noopener">GitHub</a></p>
      </section>
    </form>
  `;
}

function bind(pageEl, settings) {
  pageEl.querySelector('#btn-copy-script')?.addEventListener('click', async () => {
    const status = pageEl.querySelector('#copy-status');
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT_CODE);
      status.textContent = 'Copied!';
      setTimeout(() => { status.textContent = ''; }, 2500);
    } catch (e) {
      status.textContent = 'Copy failed';
    }
  });

  pageEl.querySelector('#btn-clear-cache')?.addEventListener('click', () => {
    ['indices', 'market', 'symbols', 'portfolio-summary', 'portfolio-txns'].forEach(clearCache);
    alert('Cache cleared.');
  });

  pageEl.querySelector('#settings-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const oldUrl = (settings.apps_script_url || '').trim();
    const newUrl = pageEl.querySelector('#apps-script-url').value.trim();
    const next = {
      ...settings,
      apps_script_url: newUrl,
      default_page: pageEl.querySelector('#default-page').value,
      refresh_interval_seconds: parseInt(pageEl.querySelector('#refresh-interval').value, 10) || 60,
    };
    saveSettings(next);
    // Update in-memory snapshot so a subsequent save in the same view sees the new value
    Object.assign(settings, next);

    // Only auto-jump to Portfolio when the user JUST configured the URL for the first time.
    // For any subsequent save, stay on Settings with a small "Saved" confirmation.
    if (!oldUrl && newUrl) {
      window.location.hash = '#/portfolio';
      return;
    }
    const btn = e.target.querySelector('button[type=submit]');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Saved';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
    }
  });
}
