const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** Idle-game number formatting: 1234 -> "1.23K", 5 -> "5". */
export function formatNumber(value, decimals = 2) {
  if (!Number.isFinite(value)) return '∞';
  const sign = value < 0 ? '-' : '';
  const n = Math.abs(value);
  if (n < 1000) {
    return sign + (n < 10 && n % 1 !== 0 ? n.toFixed(1) : Math.floor(n).toString());
  }
  const exp = Math.min(Math.floor(Math.log10(n) / 3), SUFFIXES.length - 1);
  const scaled = n / 10 ** (exp * 3);
  return `${sign}${scaled.toFixed(decimals)}${SUFFIXES[exp]}`;
}

/** Dollars are the hard currency: always two decimals, never abbreviated low. */
export function formatDollars(value) {
  return value < 1000 ? `$${value.toFixed(2)}` : `$${formatNumber(value)}`;
}

/** 5400 -> "1h 30m", 75 -> "1m 15s". */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** 1536 -> "1.5 GB" for RAM readouts. */
export function formatBytesMB(mb) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`;
}

/** Taskbar clock, mid-2000s style. */
export function formatClock(date = new Date()) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
