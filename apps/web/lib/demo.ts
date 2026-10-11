/** Local, non-verifiable practice mechanics. Never used for a Solana transaction. */
export const DEMO_START_CENTS = 100_000;
export const DEMO_MAX_BET_CENTS = 50_000;
export const CRASH_GROWTH = 0.14;
export const DEMO_DEFAULT_MAX_MULTIPLIER = 50;
export const DEMO_CEILING_MULTIPLIER = 5000;
export type Side = 'heads' | 'tails';

/** In-memory practice bookkeeping, never a security boundary against the browser owner. */
export class DemoLedger {
  private available = DEMO_START_CENTS;
  private pending: { id: string; stake: number; maxMultiplier: number } | null = null;
  private readonly used = new Set<string>();
  get balance(): number { return this.available; }
  reserve(stake: number, nonce: () => string = () => crypto.randomUUID(), maxMultiplier: number = DEMO_DEFAULT_MAX_MULTIPLIER): string | null {
    if (!Number.isSafeInteger(maxMultiplier) || maxMultiplier < 1 || maxMultiplier > DEMO_CEILING_MULTIPLIER) return null;
    if (!Number.isSafeInteger(stake) || stake < 100 || stake > DEMO_MAX_BET_CENTS || stake > this.available || this.pending) return null;
    const id = nonce();
    if (typeof id !== 'string' || !id || this.used.has(id)) throw new Error('Invalid demo reservation identity');
    this.used.add(id); this.pending = { id, stake, maxMultiplier }; this.available -= stake; return id;
  }
  settle(record: { id: string; stake: number; payout: number }): boolean {
    if (!this.pending || this.pending.id !== record.id) return false;
    if (record.stake !== this.pending.stake || !Number.isSafeInteger(record.payout) || record.payout < 0 || record.payout > this.pending.stake * this.pending.maxMultiplier || !Number.isSafeInteger(this.available + record.payout)) throw new RangeError('Invalid demo settlement');
    this.available += record.payout; this.pending = null; return true;
  }
}

export function parseDemoAmount(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return cents >= 100 && cents <= DEMO_MAX_BET_CENTS ? cents : null;
}

export function randomUnit(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 4_294_967_296;
}

export function sampleCrash(unit: number): number {
  if (!Number.isFinite(unit) || unit < 0 || unit >= 1) throw new RangeError('Invalid local randomness');
  return Math.min(50, Math.max(1, Math.floor((0.98 / (1 - unit)) * 100) / 100));
}

export function crashAt(elapsedMs: number, crashPoint: number): { multiplier: number; crashed: boolean } {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(crashPoint) || crashPoint < 1 || crashPoint > 50) throw new RangeError('Invalid demo crash time or point');
  const exact = Math.exp(Math.max(0, elapsedMs) / 1000 * CRASH_GROWTH);
  const crashed = exact >= crashPoint;
  return { multiplier: crashed ? crashPoint : Math.floor(exact * 100) / 100, crashed };
}

export function grossPayout(stakeCents: number, multiplier: number): number {
  if (!Number.isSafeInteger(stakeCents) || stakeCents < 0 || !Number.isFinite(multiplier) || multiplier < 0) {
    throw new RangeError('Invalid local payout');
  }
  // Two-decimal demo multipliers use integer hundredths to avoid 1.15 * 100 = 114.999….
  const hundredths = Math.round(multiplier * 100);
  if (!Number.isSafeInteger(hundredths)) throw new RangeError('Invalid local multiplier');
  const payout = BigInt(stakeCents) * BigInt(hundredths) / 100n;
  if (payout > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Local payout overflow');
  return Number(payout);
}

export function demoNumber(cents: number): string {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(cents / 100);
}

export function multiplierLabel(value: number): string {
  return `${value.toFixed(2).replace('.', ',')}×`;
}

export function shortAddress(address: string): string {
  return address.length <= 14 ? address : `${address.slice(0, 5)}…${address.slice(-5)}`;
}
