/**
 * Locale-aware percentages for RTP and hit-rate text (pure, no React). The ratio is rounded half-up to `digits`
 * decimals first, so the result matches the legacy Turkish helpers ("%96,5"): 0.965 -> "96.5%" (en) / "%96,5" (tr).
 */
const cache = new Map<string, Intl.NumberFormat>();
function formatter(intl: string, digits: number): Intl.NumberFormat {
  const key = `${intl}:${digits}`;
  let f = cache.get(key);
  if (!f) { f = new Intl.NumberFormat(intl, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }); cache.set(key, f); }
  return f;
}
const rounded = (ratio: number, digits: number) => Math.round(ratio * 10 ** (digits + 2)) / 10 ** (digits + 2);

/** 0.965 -> "96.5%" (en) / "%96,5" (tr). Not finite -> "—". */
export function percentOf(intl: string, ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return '—';
  return formatter(intl, digits).format(rounded(ratio, digits));
}

/** A confidence interval: 0.959..0.97 -> "95.9–97.0%" (en) / "%95,9–97,0" (tr); the percent sign appears once. */
export function percentRange(intl: string, low: number, high: number, digits = 1): string {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return '—';
  const f = formatter(intl, digits);
  const parts = f.formatToParts(rounded(high, digits));
  const prefixed = parts[0]?.type === 'percentSign';
  const numeric = (value: number) => f.formatToParts(rounded(value, digits)).filter(p => p.type !== 'percentSign' && p.type !== 'literal').map(p => p.value).join('');
  return prefixed ? `${f.format(rounded(low, digits))}–${numeric(high)}` : `${numeric(low)}–${f.format(rounded(high, digits))}`;
}
