/**
 * Pure logic for the Göreme: Şafak Balonları sound: pitch maps for reels, symbols, balloons and the sky multiplier, the
 * wind pan, merge sizes, the ways-win grading, the sun scatter tease, the multiplier callout classes, the recorded voice
 * bank (file stems and the texts of docs/product/voice-scripts.md), the wordless placeholders and the one-voice-at-a-time
 * policy. No Web Audio here, so it is unit tested in Node. Presentation only: nothing here reads or changes a result; it
 * only maps already-resolved engine steps (packages/protocol/src/goreme.ts) to sound parameters.
 */
import { VOICE_FOLDER_VERSIONS } from './voice-version.generated';
import { versionedVoiceUrl } from './voice-version';
import { multiplierClass, type MultiplierClass, type WinTier } from './win-tiers';

/** Tonic (MIDI) of the Göreme base key: F3 (F Acemaşiran colour, F G A Bb C D E). Celebrations climb F → G → A → C → D. */
export const GOREME_TONIC = 53;
/** Tonic of the feature theme (Şafak Şöleni): G (G Mahur colour, G A B C D E F#), a whole tone of lift above the base. */
export const GOREME_FEATURE_TONIC = 55;
/**
 * The F major pentatonic ladder (F G A C D) in semitones around F5 (MIDI 77). Consonant with the base theme (F
 * Acemaşiran colour) and with the celebration keys; every data-driven pitch moves only along it.
 */
export const GOREME_LADDER: readonly number[] = Object.freeze([-24, -22, -20, -17, -15, -12, -10, -8, -5, -3, 0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]);
const LADDER_ZERO = GOREME_LADDER.indexOf(0);
const finite = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** Ladder step `k` (0 = F5) → semitones; clamped to the ladder. */
export const goremeLadder = (k: number) => GOREME_LADDER[Math.max(0, Math.min(GOREME_LADDER.length - 1, LADDER_ZERO + Math.round(finite(k))))]!;

/* ---------------- reels and symbols ---------------- */

export type GoremeSymbolId = 'h1' | 'h2' | 'h3' | 'h4' | 'l1' | 'l2' | 'l3' | 'l4' | 'l5' | 'balloon' | 'sun';
export const GOREME_SYMBOL_IDS: readonly GoremeSymbolId[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4', 'l5'];
/** Win pitch by symbol (semitones above the clip's F5): h1 Peri Bacası highest, nine distinct ladder tones. */
export const GOREME_SYMBOL_SEMITONES: Readonly<Record<GoremeSymbolId, number>> = Object.freeze({ h1: 9, h2: 7, h3: 4, h4: 2, l1: 0, l2: -3, l3: -5, l4: -8, l5: -10, balloon: 0, sun: 0 });
export const goremeSymbolSemitones = (s: string | null | undefined) => (s && s in GOREME_SYMBOL_SEMITONES ? GOREME_SYMBOL_SEMITONES[s as GoremeSymbolId] : 0);

/** Reel stops 0..5 (left → right) → C D F G A C: the stops play a rising pentatonic phrase across the board. */
export const GOREME_REEL_STEPS: readonly number[] = Object.freeze([-5, -3, 0, 2, 4, 7]);
export const reelSemitones = (reel: number) => GOREME_REEL_STEPS[Math.max(0, Math.min(5, Math.round(finite(reel))))]!;
export const reelPan = (reel: number) => +((Math.max(0, Math.min(5, Math.round(finite(reel)))) - 2.5) / 3.6).toFixed(4);

/* ---------------- balloons ---------------- */

/** Balloon size class by multiplier: 1 → small, 2–4 → medium, 5–9 → large, 10+ → grand (25 is the engine's ceiling). */
export type BalloonClass = 1 | 2 | 3 | 4;
export function balloonClass(multiplier: number): BalloonClass {
  const m = finite(multiplier, 1);
  return m >= 10 ? 4 : m >= 5 ? 3 : m >= 2 ? 2 : 1;
}
/** Balloon pitch (semitones on the ladder): rises two ladder steps per doubling of the multiplier, ×1 = F5, ×25 ≈ the top. */
export function balloonSemitones(multiplier: number): number {
  const m = Math.max(1, Math.min(25, finite(multiplier, 1)));
  return goremeLadder(Math.round(Math.log2(m) * 2));
}
/** Merge "whump" size 1..2 by the merged multiplier (×2 → 1, ×25 → 2) and its rising tone (semitones on the ladder). */
export function mergeSize(multiplier: number): number {
  const m = Math.max(2, Math.min(25, finite(multiplier, 2)));
  return +(1 + (m - 2) / 23).toFixed(4);
}
export const mergeSemitones = (multiplier: number) => balloonSemitones(multiplier);

/* ---------------- wind ---------------- */

export type GoremeWind = 'left' | 'calm' | 'right';
/** Pan sweep of a gust: the wind blowing toward the left comes from the right (0.85 → −0.85) and vice versa; calm = a centred breath. */
export function windSweep(wind: string): { from: number; to: number; calm: boolean } {
  if (wind === 'left') return { from: 0.85, to: -0.85, calm: false };
  if (wind === 'right') return { from: -0.85, to: 0.85, calm: false };
  return { from: -0.2, to: 0.2, calm: true };
}

/** Burner heat 0..1 for a lift: more balloons on the board and later lifts burn hotter. */
export function burnerHeat(balloons: number, lift = 1): number {
  const b = Math.max(0, finite(balloons)), l = Math.max(1, finite(lift, 1));
  return +Math.min(1, 0.25 + 0.1 * Math.min(5, b) + 0.03 * Math.min(10, l - 1)).toFixed(4);
}

/* ---------------- sky band ---------------- */

/** Sky multiplier tick pitch: three ladder steps per doubling (×1 F5 … ×100 near the top), so every mooring climbs. */
export function skySemitones(sky: number): number {
  const v = Math.max(1, finite(sky, 1));
  return goremeLadder(Math.min(10, Math.round(Math.log2(v) * 1.5)));
}

/* ---------------- ways wins ---------------- */

/** Ways win highlight grade by the step win in multiples of the bet: 0 <1×, 1 <5×, 2 <20×, 3 ≥20×. */
export type WaysGrade = 0 | 1 | 2 | 3;
export function waysGrade(winMultiple: number): WaysGrade {
  const m = finite(winMultiple);
  return m >= 20 ? 3 : m >= 5 ? 2 : m >= 1 ? 1 : 0;
}

/* ---------------- sun scatter ---------------- */

/** Sun landing index clamp (1..6); the tease starts at the 2nd sun (3 trigger the feature). */
export const sunIndex = (n: number) => Math.max(1, Math.min(6, Math.round(finite(n, 1))));
export const sunTeases = (n: number) => sunIndex(n) === 2;

/* ---------------- callouts ---------------- */

/** Göreme multiplier announcement classes (≥×10 have their own sound; ×250+ uses the ×100 sound and line). */
export type GoremeCalloutClass = Exclude<MultiplierClass, 'x250'>;
export const GOREME_CALLOUT_CLASSES: readonly GoremeCalloutClass[] = ['x2', 'x10', 'x25', 'x50', 'x100'];
export function goremeCalloutClass(value: number): GoremeCalloutClass {
  const c = multiplierClass(value);
  return c === 'x250' ? 'x100' : c;
}
export const goremeCalloutRank = (c: GoremeCalloutClass) => GOREME_CALLOUT_CLASSES.indexOf(c);

/* ---------------- voice bank ---------------- */

/** Recorded voice lines (file stems, exactly as in docs/product/voice-scripts.md, "Göreme: Şafak Balonları"). */
export const GOREME_VOICE_LINES = [
  'x2-9', 'x10', 'x25', 'x50', 'x100', 'lift', 'wind', 'merge', 'sun-tease', 'feature-trigger', 'feature-start',
  'moor', 'sky-10', 'retrigger', 'feature-end', 'win-big', 'win-epic', 'nice',
] as const;
export type GoremeVoiceLine = (typeof GOREME_VOICE_LINES)[number];

/** Turkish texts (the dawn balloon pilot), exactly as in voice-scripts.md. */
export const GOREME_VOICE_TEXT: Readonly<Record<GoremeVoiceLine, string>> = Object.freeze({
  'x2-9': 'Yükseliyor!', x10: 'On kat!', x25: 'Yirmi beş kat!', x50: 'Elli kat!', x100: 'Yüz kat!',
  lift: 'Balonlar kalkıyor...', wind: 'Rüzgâr döndü.', merge: 'Birleştiler!', 'sun-tease': 'Güneş doğmak üzere...',
  'feature-trigger': 'Şafak söküyor!', 'feature-start': 'Şafak Şöleni!', moor: 'Göğe demirledi.', 'sky-10': 'Gökyüzü dolu!',
  retrigger: 'Beş dönüş daha!', 'feature-end': 'Güneş tepede.', 'win-big': 'Güzel uçuş!', 'win-epic': 'Vadinin üstündesin!', nice: 'Güzel.',
});
/** English texts, exactly as in voice-scripts.md. */
export const GOREME_VOICE_TEXT_EN: Readonly<Record<GoremeVoiceLine, string>> = Object.freeze({
  'x2-9': 'Rising.', x10: 'Ten times.', x25: 'Twenty-five times.', x50: 'Fifty times.', x100: 'A hundred times.',
  lift: 'The balloons lift...', wind: 'The wind turns.', merge: 'They join!', 'sun-tease': 'The sun is almost up...',
  'feature-trigger': 'Dawn breaks!', 'feature-start': 'The Dawn Festival.', moor: 'Moored in the sky.', 'sky-10': 'The sky is full!',
  retrigger: 'Five more spins.', 'feature-end': 'The sun is high.', 'win-big': 'A fine flight!', 'win-epic': 'Above the valley!', nice: 'Nice.',
});

export const GOREME_CLASS_VOICE: Readonly<Record<GoremeCalloutClass, GoremeVoiceLine>> = Object.freeze({ x2: 'x2-9', x10: 'x10', x25: 'x25', x50: 'x50', x100: 'x100' });
/** Tier lines: the script has two — "win-big" for Büyük (and the Mega / Süper heads), "win-epic" for Efsane and the max win. */
export const GOREME_TIER_VOICE: Readonly<Record<WinTier | 'max', GoremeVoiceLine>> = Object.freeze({ 1: 'win-big', 2: 'win-big', 3: 'win-big', 4: 'win-epic', max: 'win-epic' });

/** Wordless placeholder vocal ids (rendered effects: a hummed dawn voice) for a missing recording; null = none. */
export type GoremeVocal = 'vo-hum' | 'vo-rise' | 'vo-joy';
export const GOREME_VOCALS: readonly GoremeVocal[] = ['vo-hum', 'vo-rise', 'vo-joy'];
export const GOREME_PLACEHOLDER: Readonly<Record<GoremeVoiceLine, GoremeVocal | null>> = Object.freeze({
  'x2-9': null, x10: 'vo-rise', x25: 'vo-rise', x50: 'vo-joy', x100: 'vo-joy',
  lift: null, wind: null, merge: null, 'sun-tease': 'vo-hum', 'feature-trigger': 'vo-joy', 'feature-start': null,
  moor: 'vo-hum', 'sky-10': 'vo-rise', retrigger: 'vo-rise', 'feature-end': 'vo-hum', 'win-big': 'vo-rise', 'win-epic': 'vo-joy', nice: 'vo-hum',
});

/** Priority of a line when two would overlap (higher replaces lower; equal or lower is skipped). */
export const GOREME_VOICE_PRIORITY: Readonly<Record<GoremeVoiceLine, number>> = Object.freeze({
  'x2-9': 2, x10: 4, x25: 5, x50: 6, x100: 7, lift: 1, wind: 1, merge: 3, 'sun-tease': 5, 'feature-trigger': 7, 'feature-start': 6,
  moor: 4, 'sky-10': 5, retrigger: 6, 'feature-end': 6, 'win-big': 7, 'win-epic': 9, nice: 1,
});

/** One voice at a time: play when free (or the current line is about to end), replace a lower-priority line, else skip. */
export function goremeVoiceDecision(current: { line: GoremeVoiceLine; until: number } | null, next: GoremeVoiceLine, now: number, tolerance = 0.15): 'play' | 'replace' | 'skip' {
  if (!current || current.until - now <= tolerance) return 'play';
  return GOREME_VOICE_PRIORITY[next] > GOREME_VOICE_PRIORITY[current.line] ? 'replace' : 'skip';
}

/**
 * URL per line: a folder (`/audio/voice/goreme/tr` → `/audio/voice/goreme/tr/x10.mp3?v=<hash>`) or per-line URLs (blank =
 * none). With `requireVersion`, a folder that scripts/build-audio-worker.mjs did not find any mp3 in (no entry in
 * voice-version.generated.ts) yields no URLs at all, so a bank that does not exist yet costs no requests and no 404s;
 * the game then plays the wordless placeholders.
 */
export function goremeVoiceBankUrls(spec: string | Partial<Record<GoremeVoiceLine, string | null>>, opts: { ext?: string; requireVersion?: boolean } = {}): Record<GoremeVoiceLine, string | null> {
  const ext = opts.ext ?? 'mp3';
  const out = {} as Record<GoremeVoiceLine, string | null>;
  const folder = typeof spec === 'string' ? spec.trim().replace(/\/+$/, '') : '';
  const skip = typeof spec === 'string' && (!folder || (opts.requireVersion === true && !Object.hasOwn(VOICE_FOLDER_VERSIONS, folder)));
  for (const line of GOREME_VOICE_LINES) {
    if (typeof spec === 'string') out[line] = skip ? null : versionedVoiceUrl(`${folder}/${line}.${ext}`);
    else { const u = spec[line]; out[line] = typeof u === 'string' && u.trim() ? u : null; }
  }
  return out;
}

/** Load every line; any failure (missing file, network, decode) leaves that line null, silently. Never rejects. */
export async function loadGoremeVoiceBank<T>(urls: Record<GoremeVoiceLine, string | null>, load: (url: string) => Promise<T | null>): Promise<Map<GoremeVoiceLine, T | null>> {
  const entries = await Promise.all(GOREME_VOICE_LINES.map(async line => {
    const url = urls[line];
    if (!url) return [line, null] as const;
    try { return [line, (await load(url)) ?? null] as const; } catch { return [line, null] as const; }
  }));
  return new Map(entries);
}

/** Representative value per callout class (lab, tests). */
export const GOREME_CALLOUT_VALUES: Readonly<Record<GoremeCalloutClass, number>> = Object.freeze({ x2: 4, x10: 12, x25: 30, x50: 64, x100: 150 });
