/**
 * Pure logic for the Ebru: Mürekkep Bahçesi sound: the comb-sweep plan (pitch contour, pan and level that
 * follow the engine's per-row shifts), pitch maps for ink colours, stain values and drop columns, the
 * multiplier/stain callout classes, the recorded voice bank (file names), which non-verbal placeholder vocal
 * stands in for a missing line, and the one-voice-at-a-time policy. No Web Audio here, so it is unit tested
 * in Node. Presentation only: nothing here reads or changes a result; it only maps already-resolved steps
 * (packages/protocol/src/ebru.ts) to sound parameters.
 */
import { versionedVoiceUrl } from './voice-version';
import { MULTIPLIER_CLASSES, multiplierClass, multiplierRank, type MultiplierClass, type WinTier } from './win-tiers';

/** Tonic (MIDI) of the Ebru base key: G (G Rast). Celebration tiers climb from here by TIER_KEY (G → A → B → D → E). */
export const EBRU_TONIC = 55;
/** The G major pentatonic ladder (G A B D E) in semitones around G, used by every data-driven pitch map so overlapping
 *  effects stay consonant with the base theme (G Rast), its Uşşak turn (A) and the feature theme (D Rast). */
export const EBRU_LADDER: readonly number[] = Object.freeze([-17, -15, -12, -8, -5, -3, 0, 2, 4, 7, 9, 12, 14, 16, 19, 21]);
const LADDER_ZERO = EBRU_LADDER.indexOf(0);
/** Ladder step `k` (0 = G) → semitones; clamped to the ladder. */
export const ladder = (k: number) => EBRU_LADDER[Math.max(0, Math.min(EBRU_LADDER.length - 1, LADDER_ZERO + Math.round(k)))]!;

/* ---------------- colours, stains, drops ---------------- */

export type EbruInk = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7' | 'c8';
export const EBRU_INKS: readonly EbruInk[] = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];
/** Pigment pitch by colour (semitones above the bloom clip's G): c1 (highest pay) highest, eight distinct ladder tones. */
export const COLOUR_SEMITONES: Readonly<Record<EbruInk, number>> = Object.freeze({ c1: 9, c2: 7, c3: 4, c4: 2, c5: 0, c6: -3, c7: -5, c8: -8 });
export function colourSemitones(colour: string | undefined | null): number {
  return colour && colour in COLOUR_SEMITONES ? COLOUR_SEMITONES[colour as EbruInk] : 0;
}

/** Bloom size class: 5–7 cells small, 8–11 medium, 12+ large. */
export type BloomSize = 's' | 'm' | 'l';
export const bloomSize = (cells: number): BloomSize => (!(cells >= 8) ? 's' : cells >= 12 ? 'l' : 'm');

/** Stain values 2, 4, …, 256 → the glassy ping climbs one ladder step per doubling (G A B D E G A B). */
export const STAIN_STEPS: readonly number[] = Object.freeze([0, 2, 4, 7, 9, 12, 14, 16]);
export function stainSemitones(value: number): number {
  if (!Number.isFinite(value) || value < 2) return 0;
  const k = Math.max(0, Math.min(STAIN_STEPS.length - 1, Math.floor(Math.log2(value)) - 1));
  return STAIN_STEPS[k]!;
}
/** Stain level 0..1 (×2 → 0, ×256 → 1) for gain and brightness. */
export const stainLevel = (value: number) => (!Number.isFinite(value) || value < 2 ? 0 : Math.min(1, (Math.log2(value) - 1) / 7));

/** Drop columns 0..6 (left → right) → D E G A B D E: the drops play a little rising scale across the board. */
export const DROP_STEPS: readonly number[] = Object.freeze([-5, -3, 0, 2, 4, 7, 9]);
export const dropSemitones = (col: number) => DROP_STEPS[Math.max(0, Math.min(6, Math.round(Number.isFinite(col) ? col : 0)))]!;

/* ---------------- comb sweep ---------------- */

export const COMB_ROWS = 7;
/** Shortest and longest comb sweep the sound follows (the visual may differ; the sound clamps). */
export const COMB_MIN_SECONDS = 0.35;
export const COMB_MAX_SECONDS = 3;
/** Points of the rate / pan / level automation curves. */
export const COMB_CURVE_POINTS = 96;
/** Highest glide pitch (semitones above G5). */
export const COMB_TOP_SEMITONES = 9;

export interface CombRow { row: number; at: number; shift: number; semitones: number; rate: number; pan: number; level: number }
export interface CombPlan {
  seconds: number;
  pass: number;
  rows: CombRow[];
  /** playbackRate curve of the glide tone (2^(semitones/12)), sine-shaped between the rows. */
  rate: Float32Array;
  /** Stereo position curve (−1..1): the comb pulls the water the way the rows move. */
  pan: Float32Array;
  /** Bristle level curve 0..1: larger shifts move more water. */
  level: Float32Array;
  /** Widest shift of the pass (0..3). */
  amplitude: number;
}

const cosInterp = (a: number, b: number, x: number) => a + (b - a) * (1 - Math.cos(Math.PI * x)) * 0.5;

/**
 * The comb sweep as sound: the comb passes over rows 0..6 (top → bottom) in `ms` milliseconds; each row is a
 * point of the pitch contour — its cyclic shift (−3..3, positive = right) picks a G-pentatonic step around the
 * pass's centre (pass 2 and 3 sit one and two steps higher, so repeated passes climb, capped at E6). Between rows the pitch
 * glides with a raised-cosine (sine-shaped) curve, so a comb whose shifts come from a sine table sings that sine.
 * Pan follows the shift direction, the level its size. Non-finite or out-of-range shifts are clamped.
 */
export function combPlan(shifts: readonly number[], ms: number, pass = 1): CombPlan {
  const seconds = Math.max(COMB_MIN_SECONDS, Math.min(COMB_MAX_SECONDS, (Number.isFinite(ms) ? ms : 1200) / 1000));
  const p = Math.max(1, Math.min(3, Math.round(Number.isFinite(pass) ? pass : 1)));
  const clean = Array.from({ length: COMB_ROWS }, (_, r) => { const v = Number(shifts[r]); return Number.isFinite(v) ? Math.max(-3, Math.min(3, Math.round(v))) : 0; });
  const rows: CombRow[] = clean.map((shift, row) => {
    // capped at E (+9, rate 1.68): with the longest sweep the glide clip (5.2 s sustained) always covers the pass
    const semitones = Math.min(COMB_TOP_SEMITONES, ladder(shift + (p - 1)));
    return { row, at: (seconds * (row + 0.5)) / COMB_ROWS, shift, semitones, rate: 2 ** (semitones / 12), pan: Math.max(-0.75, Math.min(0.75, shift * 0.25)), level: 0.55 + 0.15 * Math.abs(shift) };
  });
  const n = COMB_CURVE_POINTS, rate = new Float32Array(n), pan = new Float32Array(n), level = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.max(0, Math.min(COMB_ROWS - 1, (i / (n - 1)) * COMB_ROWS - 0.5));
    const a = Math.floor(u), b = Math.min(COMB_ROWS - 1, a + 1), x = u - a;
    const semi = cosInterp(rows[a]!.semitones, rows[b]!.semitones, x);
    rate[i] = 2 ** (semi / 12);
    pan[i] = cosInterp(rows[a]!.pan, rows[b]!.pan, x);
    level[i] = cosInterp(rows[a]!.level, rows[b]!.level, x);
  }
  return { seconds, pass: p, rows, rate, pan, level, amplitude: Math.max(...clean.map(Math.abs)) };
}

/* ---------------- callouts ---------------- */

/** Callout classes (multiplier of a stained cluster, stain sum or total): <10, ≥10, ≥25, ≥50, ≥100, ≥250. */
export type EbruCalloutClass = MultiplierClass;
export const EBRU_CALLOUT_CLASSES: readonly EbruCalloutClass[] = MULTIPLIER_CLASSES;
export const ebruCalloutClass = (value: number): EbruCalloutClass => multiplierClass(value);
export const ebruCalloutRank = (c: EbruCalloutClass) => multiplierRank(c);

/* ---------------- voice bank ---------------- */

/** Recorded voice lines (file stem → when). The intended words are in EBRU_VOICE_TEXT (an ebru master's calm voice). */
export const EBRU_VOICE_LINES = [
  'x2-9', 'x10', 'x25', 'x50', 'x100', 'x250',
  'scatter-tease', 'feature-trigger', 'feature-start', 'retrigger',
  'win-big', 'win-mega', 'win-super', 'win-legend', 'win-max',
  'comb', 'nice', 'feature-end',
] as const;
export type EbruVoiceLine = (typeof EBRU_VOICE_LINES)[number];

/** Suggested words per line (Turkish), for the voice script; the sound itself never needs them. */
export const EBRU_VOICE_TEXT: Readonly<Record<EbruVoiceLine, string>> = Object.freeze({
  'x2-9': 'Renk!', x10: 'On kat!', x25: 'Yirmi beş kat!', x50: 'Elli kat!', x100: 'Yüz kat!', x250: 'İki yüz elli kat!',
  'scatter-tease': 'Bir tarak daha…', 'feature-trigger': 'Altın taraklar!', 'feature-start': 'Lale ebrusu başlıyor.', retrigger: 'Dört dönüş daha!',
  'win-big': 'Büyük kazanç!', 'win-mega': 'Mega kazanç!', 'win-super': 'Süper kazanç!', 'win-legend': 'Efsane kazanç!', 'win-max': 'Azami kazanç!',
  comb: 'Tarak suda…', nice: 'Güzel!', 'feature-end': 'Bahçe tamam.',
});

export const EBRU_CLASS_VOICE: Readonly<Record<EbruCalloutClass, EbruVoiceLine>> = Object.freeze({ x2: 'x2-9', x10: 'x10', x25: 'x25', x50: 'x50', x100: 'x100', x250: 'x250' });
export const EBRU_TIER_VOICE: Readonly<Record<WinTier | 'max', EbruVoiceLine>> = Object.freeze({ 1: 'win-big', 2: 'win-mega', 3: 'win-super', 4: 'win-legend', max: 'win-max' });

/** Non-verbal placeholder vocal ids (rendered effects: a wordless "ah") that stand in for a missing line; null = none. */
export type EbruVocal = 'vo-sigh' | 'vo-bloom' | 'vo-joy';
export const EBRU_PLACEHOLDER: Readonly<Record<EbruVoiceLine, EbruVocal | null>> = Object.freeze({
  'x2-9': null, x10: 'vo-bloom', x25: 'vo-bloom', x50: 'vo-joy', x100: 'vo-joy', x250: 'vo-joy',
  'scatter-tease': 'vo-sigh', 'feature-trigger': 'vo-joy', 'feature-start': null, retrigger: 'vo-bloom',
  'win-big': 'vo-bloom', 'win-mega': 'vo-bloom', 'win-super': 'vo-joy', 'win-legend': 'vo-joy', 'win-max': 'vo-joy',
  comb: null, nice: 'vo-sigh', 'feature-end': 'vo-sigh',
});

/** Priority of a line when two would overlap (higher replaces lower; equal or lower is skipped). */
export const EBRU_VOICE_PRIORITY: Readonly<Record<EbruVoiceLine, number>> = Object.freeze({
  'x2-9': 2, x10: 4, x25: 5, x50: 6, x100: 7, x250: 8,
  'scatter-tease': 5, 'feature-trigger': 7, 'feature-start': 6, retrigger: 6,
  'win-big': 6, 'win-mega': 7, 'win-super': 8, 'win-legend': 9, 'win-max': 10,
  comb: 1, nice: 1, 'feature-end': 6,
});

/** One voice at a time: play when free (or the current line is about to end), replace a lower-priority line, else skip. */
export function ebruVoiceDecision(current: { line: EbruVoiceLine; until: number } | null, next: EbruVoiceLine, now: number, tolerance = 0.15): 'play' | 'replace' | 'skip' {
  if (!current || current.until - now <= tolerance) return 'play';
  return EBRU_VOICE_PRIORITY[next] > EBRU_VOICE_PRIORITY[current.line] ? 'replace' : 'skip';
}

/** URL per line: a folder (`/audio/voice/ebru` → `/audio/voice/ebru/x10.mp3`) or per-line URLs (blank = none). */
export function ebruVoiceBankUrls(spec: string | Partial<Record<EbruVoiceLine, string | null>>, ext = 'mp3'): Record<EbruVoiceLine, string | null> {
  const out = {} as Record<EbruVoiceLine, string | null>;
  for (const line of EBRU_VOICE_LINES) {
    if (typeof spec === 'string') out[line] = spec.trim() ? versionedVoiceUrl(`${spec.trim().replace(/\/+$/, '')}/${line}.${ext}`) : null;
    else { const u = spec[line]; out[line] = typeof u === 'string' && u.trim() ? u : null; }
  }
  return out;
}

/** Load every line; any failure (missing file, network, decode) leaves that line null, silently. Never rejects. */
export async function loadEbruVoiceBank<T>(urls: Record<EbruVoiceLine, string | null>, load: (url: string) => Promise<T | null>): Promise<Map<EbruVoiceLine, T | null>> {
  const entries = await Promise.all(EBRU_VOICE_LINES.map(async line => {
    const url = urls[line];
    if (!url) return [line, null] as const;
    try { return [line, (await load(url)) ?? null] as const; } catch { return [line, null] as const; }
  }));
  return new Map(entries);
}
