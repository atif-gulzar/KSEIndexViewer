const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow } = window.__TAURI__.window;

let allIndices = [];
let settings = {
  enabled_indices: ['KSE100', 'KSE30', 'KMI30', 'ALLSHR'],
  pinned_to_tray_index: 'KSE100',
  refresh_interval_seconds: 300,
  always_on_top: true,
  launch_at_startup: false,
};

let currentView = 'widget';
let lastRefreshTime = null;
let countdownInterval = null;

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function renderWidget() {
  const container = document.getElementById('app');
  const enabledData = allIndices.filter(d => settings.enabled_indices.includes(d.name));

  container.innerHTML = `
    <div class="widget">
      <div class="titlebar" data-tauri-drag-region>
        <span class="title">PSX Indices</span>
        <div class="titlebar-buttons">
          <button class="btn-icon" id="btn-refresh" title="Refresh">&#8635;</button>
          <button class="btn-icon" id="btn-settings" title="Settings">&#9881;</button>
          <button class="btn-icon btn-close" id="btn-close" title="Hide to Tray">&#10005;</button>
        </div>
      </div>
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
      <div class="statusbar" id="statusbar">
        <span id="last-updated">${lastRefreshTime ? `Updated ${formatTime(lastRefreshTime)}` : 'Loading...'}</span>
        <span id="countdown"></span>
      </div>
    </div>
  `;

  document.getElementById('btn-refresh')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh');
    btn.classList.add('spinning');
    try {
      const data = await invoke('refresh_data');
      allIndices = data;
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
          <label class="checkbox-row">
            <input type="checkbox" id="ontop-checkbox" ${settings.always_on_top ? 'checked' : ''}>
            <span class="checkbox-name">Always on top</span>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" id="startup-checkbox" ${settings.launch_at_startup ? 'checked' : ''}>
            <span class="checkbox-name">Launch at Windows startup</span>
          </label>
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

    settings.enabled_indices = enabled;
    settings.pinned_to_tray_index = traySelect.value;
    settings.refresh_interval_seconds = parseInt(refreshSelect.value, 10);
    settings.always_on_top = ontopCheckbox.checked;
    settings.launch_at_startup = startupCheckbox.checked;

    await invoke('save_app_settings', { newSettings: settings });
    await invoke('set_always_on_top', { onTop: settings.always_on_top });

    currentView = 'widget';
    renderWidget();
  });
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

  // Listen for data updates from auto-refresh
  await listen('data-updated', (event) => {
    allIndices = event.payload;
    lastRefreshTime = new Date();
    if (currentView === 'widget') {
      renderWidget();
    }
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
