// Tiny localStorage wrapper with namespaced keys + sensible defaults.

const PREFIX = 'kse:';

export const DEFAULT_SETTINGS = {
  apps_script_url: '',
  default_page: 'indices',
  refresh_interval_seconds: 60,
};

export function getSettings() {
  try {
    const raw = localStorage.getItem(PREFIX + 'settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {}
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(PREFIX + 'settings', JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save settings:', e);
  }
}

export function getCache(key) {
  try {
    const raw = localStorage.getItem(PREFIX + 'cache:' + key);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

export function setCache(key, value) {
  try {
    localStorage.setItem(PREFIX + 'cache:' + key, JSON.stringify(value));
  } catch (e) {}
}

export function clearCache(key) {
  try {
    localStorage.removeItem(PREFIX + 'cache:' + key);
  } catch (e) {}
}
