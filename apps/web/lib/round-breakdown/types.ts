/**
 * Round breakdown ("Tur ayrıntısı"): a presentation-only view of how an engine round adds up to its payout.
 *
 * Every number in a breakdown is COPIED from the engine round (per-win pay, multipliers, per-step and per-spin totals,
 * the round total and the payout); the adapters in this folder never compute a pay of their own. `verifyBreakdown`
 * then re-adds those copied numbers with the rules the engine documents (integer arithmetic only) and reports every
 * place where the chain would not reproduce the engine's own field. The panel shows that check next to the total; the
 * unit tests run it over many seeded rounds of every game and mode and require zero mismatches.
 *
 * Amounts are fractions of the BET: `amount / unit` x bet, with unit 100 (hundredths, every game) or 10 000
 * (ten-thousandths, Göreme ways lines before the board floor).
 */

export type BreakdownGame = 'cascade' | 'tarhun' | 'ebru' | 'cezeri' | 'asena' | 'goreme' | 'damla';
export type BreakdownUnit = 100 | 10_000;

/** A multiplier that the engine applies; `value` is an integer factor. */
export interface BreakdownFactor {
  /** Which engine multiplier it is (the panel names it). */
  kind: 'crystals' | 'orbs' | 'total' | 'stain' | 'hub' | 'template' | 'global' | 'sky' | 'ways';
  value: number;
  /** Optional engine name (e.g. Asena constellation id). */
  name?: string;
}

/** One paid win as the engine lists it. amount = min(clamp, (base - deduct) x product(factors)). */
export interface BreakdownLine {
  kind: 'cluster' | 'ways' | 'spoke' | 'scatter' | 'pool';
  /** Engine symbol id (the game supplies the visible name). */
  symbol: string;
  /** Cluster size, symbol count, ways run length (reels), spoke run length or scatter count. */
  count: number;
  /** Ways: plain way count. */
  ways?: number;
  /** Spoke number (Cezeri, 1-based for display) and the ring the run starts on. */
  spoke?: number;
  startRing?: number;
  /** Cezeri: 1-based rotation of the gear-lock chain that paid this line. */
  rotation?: number;
  /** Damla: the drop path ("LRRL…") and the pool index. */
  path?: string;
  slot?: number;
  /** The paytable value the engine used (in `unit`). */
  base: number;
  /** Already paid part subtracted before the factors (Cezeri: a run that grew pays only the difference). */
  deduct?: number;
  factors: BreakdownFactor[];
  /** Engine clamp of a single line (Göreme: the cap), in `unit`. */
  clamp?: number;
  /** The engine's own amount of this win, in `unit`. */
  amount: number;
  unit: BreakdownUnit;
  /** Göreme: this way's share of the cents its board adds to the payout (after the sky and the floor), the same
   * amount the board label shows; the shares of a round sum to the payout. Shown instead of bet x amount. */
  shareCents?: number;
}

/** One tumble / rotation / board of a spin. amount = min(clamp, floor(sum(lines) x product(factors) / divisor)). */
export interface BreakdownGroup {
  /** 1-based step number inside the spin (tumble, rotation or board). */
  step: number;
  lines: BreakdownLine[];
  /** Unit of the lines (the group amount is always in hundredths). */
  unit: BreakdownUnit;
  factors: BreakdownFactor[];
  /** unit / 100: 1 for hundredths lines, 100 for Göreme's ten-thousandths (the engine floors the board). */
  divisor: number;
  clamp?: number;
  /** The engine's step amount in hundredths. */
  amountHundredths: number;
}

/** One spin (base or free). win = sum(groups) x product(factors) + sum(extras). */
export interface BreakdownSpin {
  index: number;
  kind: 'base' | 'free';
  groups: BreakdownGroup[];
  /** Multipliers applied to the sum of the groups (Cascade crystals, Tarhun orbs / total multiplier). */
  factors: BreakdownFactor[];
  /** Wins added after the factors (scatter pays), unit 100. */
  extras: BreakdownLine[];
  /** The engine's spin win in hundredths, before the round cap. */
  winHundredths: number;
}

export interface RoundBreakdown {
  game: BreakdownGame;
  engine: string;
  mode: string;
  seedHex: string;
  betCents: number;
  spins: BreakdownSpin[];
  /** Round cap in hundredths of the bet; null when the game has no cap reduction (Damla pays its pool). */
  capHundredths: number | null;
  /** True when the engine cut the round at the cap. */
  capped: boolean;
  /** The engine's round total in hundredths of the bet. */
  totalHundredths: number;
  /** The engine's payout in cents. */
  payoutCents: number;
}

export interface BreakdownCheck {
  ok: boolean;
  /** Sum of the spin wins (before the cap). */
  sumHundredths: number;
  /** min(cap, sum) when capped, else the sum. */
  totalHundredths: number;
  /** floor(bet x total / 100). */
  payoutCents: number;
  /** Human-readable paths of every mismatch (empty when ok). */
  mismatches: string[];
}

const product = (factors: readonly BreakdownFactor[]): bigint => factors.reduce((p, f) => p * BigInt(f.value), 1n);
const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/** Line amount by the documented rule (BigInt, exact). */
export function lineAmount(line: BreakdownLine): bigint {
  const raw = (BigInt(line.base) - BigInt(line.deduct ?? 0)) * product(line.factors);
  return line.clamp === undefined ? raw : minBig(raw, BigInt(line.clamp));
}
export function linesSum(lines: readonly BreakdownLine[]): bigint {
  return lines.reduce((s, l) => s + BigInt(l.amount), 0n);
}
/** Group amount in hundredths by the documented rule. */
export function groupAmount(group: BreakdownGroup): bigint {
  const raw = (linesSum(group.lines) * product(group.factors)) / BigInt(group.divisor);
  return group.clamp === undefined ? raw : minBig(raw, BigInt(group.clamp));
}
export function groupsSum(spin: BreakdownSpin): bigint {
  return spin.groups.reduce((s, g) => s + BigInt(g.amountHundredths), 0n);
}
export function spinAmount(spin: BreakdownSpin): bigint {
  return groupsSum(spin) * product(spin.factors) + linesSum(spin.extras);
}

/** Re-adds the copied engine numbers and lists every place where the documented arithmetic does not reproduce them. */
export function verifyBreakdown(b: RoundBreakdown): BreakdownCheck {
  const mismatches: string[] = [];
  let sum = 0n;
  for (const spin of b.spins) {
    const at = `spin ${spin.index}`;
    for (const group of spin.groups) {
      for (const [i, line] of group.lines.entries()) {
        if (lineAmount(line) !== BigInt(line.amount)) mismatches.push(`${at} step ${group.step} line ${i}: ${lineAmount(line)} != ${line.amount}`);
      }
      if (groupAmount(group) !== BigInt(group.amountHundredths)) mismatches.push(`${at} step ${group.step}: ${groupAmount(group)} != ${group.amountHundredths}`);
    }
    for (const [i, line] of spin.extras.entries()) {
      if (lineAmount(line) !== BigInt(line.amount)) mismatches.push(`${at} extra ${i}: ${lineAmount(line)} != ${line.amount}`);
    }
    if (spinAmount(spin) !== BigInt(spin.winHundredths)) mismatches.push(`${at}: ${spinAmount(spin)} != ${spin.winHundredths}`);
    sum += BigInt(spin.winHundredths);
  }
  let total = sum;
  if (b.capHundredths !== null && b.capped) {
    if (sum < BigInt(b.capHundredths)) mismatches.push(`capped round below the cap: ${sum} < ${b.capHundredths}`);
    total = BigInt(b.capHundredths);
  } else if (b.capHundredths !== null && sum > BigInt(b.capHundredths)) {
    mismatches.push(`uncapped round above the cap: ${sum} > ${b.capHundredths}`);
  }
  if (total !== BigInt(b.totalHundredths)) mismatches.push(`total: ${total} != ${b.totalHundredths}`);
  const payout = (BigInt(b.betCents) * total) / 100n;
  if (payout !== BigInt(b.payoutCents)) mismatches.push(`payout: ${payout} != ${b.payoutCents}`);
  return { ok: mismatches.length === 0, sumHundredths: Number(sum), totalHundredths: Number(total), payoutCents: Number(payout), mismatches };
}

/** Every paid line of the round, in play order (for counting and the browser summary). */
export function allLines(b: RoundBreakdown): BreakdownLine[] {
  return b.spins.flatMap(s => [...s.groups.flatMap(g => g.lines), ...s.extras]);
}

/**
 * Exact decimal text of `value / 10^digits` with the locale's separators, at least `minDigits` fraction digits and
 * trailing zeros trimmed beyond that. Integer arithmetic only (BigInt), so ten-thousandths of a cent stay exact.
 */
export function exactDecimal(value: bigint, digits: number, decimal: string, group: (whole: bigint) => string, minDigits = 2): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(digits);
  const whole = abs / scale;
  let fraction = (abs % scale).toString().padStart(digits, '0');
  while (fraction.length > minDigits && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  const body = fraction.length ? `${group(whole)}${decimal}${fraction}` : group(whole);
  return negative ? `−${body}` : body;
}
