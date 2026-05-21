// Shared number / date formatters.

export function formatSigned(n, decimals = 2) {
  if (n == null || !isFinite(n) || n === 0) return (0).toFixed(decimals);
  const sign = n > 0 ? '+' : '';
  return sign + n.toFixed(decimals);
}

export function formatMoney(n) {
  if (n == null || !isFinite(n)) return '0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 10000) return sign + abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return sign + abs.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export function formatSignedMoney(n) {
  if (n == null || !isFinite(n) || n === 0) return formatMoney(0);
  const sign = n > 0 ? '+' : '-';
  return sign + formatMoney(Math.abs(n));
}

export function todayIsoDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
