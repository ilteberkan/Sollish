/**
 * Pure logic for the Cezeri: Zamanın Çarkları sound: the ratchet plan of a turning ring (one pawl click per slice that
 * passes, timed by the ring's easing, plus the speed curve the gear whirr follows), the spoke win beam (one chime per
 * ring, inner → outer, pitched by symbol), the hub-tick ladder of the Dişli Kilidi chain (the makam scale of the scene,
 * one step per respin), hub reveal classes and multiplier class crossings, pitch maps for vessels and the reservoir,
 * the recorded voice bank (file names, Turkish texts), the non-verbal placeholders and the one-voice-at-a-time policy.
 * No Web Audio here, so it is unit tested in Node. Presentation only: nothing here reads or changes a result; it only
 * maps already-resolved steps (packages/protocol/src/cezeri.ts) to sound parameters.
 */
import { versionedVoiceUrl } from './voice-version';
import { MULTIPLIER_CLASSES, multiplierClass, multiplierRank, type MultiplierClass, type WinTier } from './win-tiers';

/** Tonic (MIDI) of the Cezeri base key: C (C Nikriz). Celebration tiers climb from here by TIER_KEY (C → D → E → G → A). */
export const CEZERI_TONIC = 48;
/**
 * The C "suspended" ladder (C D G A) in semitones around C5, used by every data-driven pitch map: it is consonant with
 * the base theme (C Nikriz: C D Eb F# G A Bb), the feature theme (C Çargah: C D E F G A B) and the open-fifth chain
 * cadence, so beams, vessels and callouts never clash with the music whichever scene is playing.
 */
export const CEZERI_LADDER: readonly number[] = Object.freeze([-24, -22, -17, -15, -12, -10, -5, -3, 0, 2, 7, 9, 12, 14, 19, 21, 24, 26, 31, 33]);
const LADDER_ZERO = CEZERI_LADDER.indexOf(0);
/** Ladder step `k` (0 = C5) → semitones; clamped to the ladder. */
export const ladder = (k: number) => CEZERI_LADDER[Math.max(0, Math.min(CEZERI_LADDER.length - 1, LADDER_ZERO + Math.round(Number.isFinite(k) ? k : 0)))]!;

/* ---------------- symbols and spokes ---------------- */

export type CezeriSymbolId = 'h1' | 'h2' | 'h3' | 'h4' | 'l1' | 'l2' | 'l3' | 'l4' | 'gear';
export const CEZERI_SYMBOLS: readonly CezeriSymbolId[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4', 'gear'];
/** First beam note per symbol as a ladder step (h1 highest; the Altın Dişli wild sits above every pay symbol). */
export const SYMBOL_STEP: Readonly<Record<CezeriSymbolId, number>> = Object.freeze({ h1: 5, h2: 4, h3: 3, h4: 2, l1: 1, l2: 0, l3: -1, l4: -2, gear: 6 });
export const symbolStep = (s: string | null | undefined) => (s && s in SYMBOL_STEP ? SYMBOL_STEP[s as CezeriSymbolId] : 0);

export const CEZERI_SPOKES = 12;
export const CEZERI_RINGS = 4;
/** Spoke s points at s × 30° clockwise from the top: its sound sits where it points (left/right). */
export const spokePan = (spoke: number) => +(0.7 * Math.sin(((((Math.round(Number.isFinite(spoke) ? spoke : 0) % 12) + 12) % 12) * Math.PI) / 6)).toFixed(4);

/** Beam note clips, rendered at C5, C6 and C7 (MIDI 72, 84, 96): each note uses the nearest, so no clip moves more than half an octave. */
export const BEAM_CLIPS = [{ id: 'beam-1', semitones: 0 }, { id: 'beam-2', semitones: 12 }, { id: 'beam-3', semitones: 24 }] as const;
export type BeamClip = (typeof BEAM_CLIPS)[number]['id'];
export interface BeamNote { ring: number; at: number; semitones: number; clip: BeamClip; rate: number; pan: number; gain: number }
export interface BeamPlan { spoke: number; seconds: number; notes: BeamNote[]; pan: number; gear: boolean }
/** Default spacing of the beam notes (s): the light runs from the hub outward, one ring every 70 ms. */
export const BEAM_STEP = 0.07;

/**
 * A spoke win as sound: one chime per winning slice from `startRing` outward, climbing the ladder from the symbol's
 * step, `step` seconds apart, panned where the spoke points; 4-slice runs end a little louder. Junk input is clamped.
 */
export function beamPlan(spoke: number, length: number, startRing: number, symbol: string, step = BEAM_STEP): BeamPlan {
  const len = Math.max(3, Math.min(4, Math.round(Number.isFinite(length) ? length : 3)));
  const start = Math.max(0, Math.min(CEZERI_RINGS - len, Math.round(Number.isFinite(startRing) ? startRing : 0)));
  const dt = Math.max(0.02, Math.min(0.25, Number.isFinite(step) ? step : BEAM_STEP));
  const root = symbolStep(symbol), pan = spokePan(spoke);
  const notes: BeamNote[] = Array.from({ length: len }, (_, i) => {
    const semitones = ladder(root + i);
    const clip = BEAM_CLIPS.reduce((best, c) => (Math.abs(c.semitones - semitones) < Math.abs(best.semitones - semitones) ? c : best));
    return { ring: start + i, at: i * dt, semitones, clip: clip.id, rate: 2 ** ((semitones - clip.semitones) / 12), pan, gain: 0.5 + 0.07 * i + (len === 4 && i === 3 ? 0.08 : 0) };
  });
  return { spoke: ((Math.round(Number.isFinite(spoke) ? spoke : 0) % 12) + 12) % 12, seconds: (len - 1) * dt, notes, pan, gear: symbol === 'gear' };
}

/* ---------------- ring rotation: pawl clicks that follow the stop distance ---------------- */

export type RingEase = 'linear' | 'outQuad' | 'outCubic' | 'outQuart' | 'outExpo' | 'inOutCubic';
export const RING_EASES: Readonly<Record<RingEase, (x: number) => number>> = Object.freeze({
  linear: (x: number) => x,
  outQuad: (x: number) => 1 - (1 - x) ** 2,
  outCubic: (x: number) => 1 - (1 - x) ** 3,
  outQuart: (x: number) => 1 - (1 - x) ** 4,
  outExpo: (x: number) => (x >= 1 ? 1 : (1 - 2 ** (-10 * x)) / (1 - 2 ** -10)),
  inOutCubic: (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
});
/** Pawl clicks closer than this blur into the whirr and are not scheduled (s). */
export const RATCHET_MIN_GAP = 0.022;
export const RATCHET_MAX_CLICKS = 40;
export const RING_MIN_SECONDS = 0.15;
export const RING_MAX_SECONDS = 6;
export const RING_CURVE_POINTS = 64;
/** Per ring (0 = innermost, small wheel → 3 = outermost, big wheel): playback rate of the click and stop clips, level and position. */
export const RING_VOICE: readonly { rate: number; gain: number; pan: number }[] = Object.freeze([
  { rate: 1.26, gain: 0.8, pan: -0.12 }, { rate: 1.12, gain: 0.86, pan: 0.14 }, { rate: 0.94, gain: 0.92, pan: -0.24 }, { rate: 0.8, gain: 1, pan: 0.28 },
]);

export interface RatchetClick { slice: number; at: number; gain: number }
export interface RatchetPlan {
  ring: number; distance: number; seconds: number; clicks: RatchetClick[];
  /** Playback-rate curve of the whirr layer (follows the ring's speed). */
  whirrRate: Float32Array;
  /** Level curve of the whirr layer 0..1 (loud while fast, gone at the stop). */
  whirrLevel: Float32Array;
}

/** x in 0..1 with ease(x) = y, by bisection (any monotonic easing). */
export function invertEase(ease: (x: number) => number, y: number): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (ease(mid) < y) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/**
 * The turning ring as sound: the ring passes `distance` slices in `ms` along `ease` (the same easing the board uses for
 * its angle). The pawl clicks once per slice boundary, at the time the angle crosses it: dense at the start (where
 * closer than RATCHET_MIN_GAP they are left to the whirr), spreading out as the ring slows, the last one exactly at the
 * stop. Clicks get louder as they slow (each one is heard on its own). The whirr's rate and level follow the speed.
 */
export function ratchetPlan(ring: number, distance: number, ms: number, ease: RingEase | ((x: number) => number) = 'outCubic'): RatchetPlan {
  const r = Math.max(0, Math.min(3, Math.round(Number.isFinite(ring) ? ring : 0)));
  const d = Math.max(1, Math.min(400, Math.round(Number.isFinite(distance) ? Math.abs(distance) : 12)));
  const seconds = Math.max(RING_MIN_SECONDS, Math.min(RING_MAX_SECONDS, (Number.isFinite(ms) ? ms : 1500) / 1000));
  const fn = typeof ease === 'function' ? ease : RING_EASES[ease] ?? RING_EASES.outCubic;
  const gap = Math.max(RATCHET_MIN_GAP, seconds / RATCHET_MAX_CLICKS);
  const times = Array.from({ length: d }, (_, k) => seconds * invertEase(fn, (k + 1) / d));
  times[d - 1] = seconds;
  const clicks: RatchetClick[] = [];
  let lastAt = -Infinity;
  for (let k = d - 1; k >= 0; k--) {
    const at = times[k]!;
    if (lastAt - at < gap && k !== d - 1) continue;
    const natural = k > 0 ? at - times[k - 1]! : at;
    clicks.push({ slice: k + 1, at, gain: Math.max(0.3, Math.min(1, 0.3 + 0.7 * (natural / 0.09))) });
    lastAt = at;
  }
  clicks.reverse();
  const n = RING_CURVE_POINTS, whirrRate = new Float32Array(n), whirrLevel = new Float32Array(n);
  const h = 1e-3;
  let maxV = 0;
  const speed = Array.from({ length: n }, (_, i) => { const x = Math.min(1 - h, i / (n - 1)); const v = Math.max(0, (fn(Math.min(1, x + h)) - fn(Math.max(0, x - h))) / (2 * h)); maxV = Math.max(maxV, v); return v; });
  for (let i = 0; i < n; i++) {
    const s = maxV > 0 ? speed[i]! / maxV : 0;
    whirrRate[i] = 0.5 + 0.8 * s;
    whirrLevel[i] = i === n - 1 ? 0 : Math.min(1, s ** 0.7 * Math.min(1, (i + 1) / 3));
  }
  return { ring: r, distance: d, seconds, clicks, whirrRate, whirrLevel };
}

/* ---------------- the Dişli Kilidi chain: hub ticks climb the scene's makam ---------------- */

export const CEZERI_MAX_RESPINS = 10;
/** C Nikriz from C5 (C D Eb F# G A Bb C D Eb F#): hub reveal on C, respin k climbs to the k-th degree — the 10th lands on the high F#, the tensest note, and the chain cadence resolves it. */
export const HUB_STEPS_NIKRIZ: readonly number[] = Object.freeze([0, 2, 3, 6, 7, 9, 10, 12, 14, 15, 18]);
/** C Çargah (major) from C5 for the Fil Saati feature: the same climb, each degree at most a semitone from the Nikriz one. */
export const HUB_STEPS_CARGAH: readonly number[] = Object.freeze([0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17]);
export type HubMode = 'nikriz' | 'cargah';
export const hubRound = (round: number) => Math.max(0, Math.min(CEZERI_MAX_RESPINS, Math.round(Number.isFinite(round) ? round : 0)));
export const hubSemitones = (round: number, mode: HubMode = 'nikriz') => (mode === 'cargah' ? HUB_STEPS_CARGAH : HUB_STEPS_NIKRIZ)[hubRound(round)]!;
/** The hub-step clips are rendered on the Nikriz degrees; in the feature they are bent (≤ 1 semitone) onto Çargah. */
export const hubStepRate = (round: number, mode: HubMode = 'nikriz') => 2 ** ((hubSemitones(round, mode) - hubSemitones(round, 'nikriz')) / 12);

/** Chain tension 0..1 after `round` respins: drives the tension bed's filter, level and the upper layer (from round 4). */
export const chainTension = (round: number) => hubRound(round) / CEZERI_MAX_RESPINS;
/** Low-pass cutoff of the tension bed (Hz): opens exponentially from 700 Hz (first respin) to 14 kHz (tenth). */
export const tensionCutoff = (round: number) => Math.round(700 * 20 ** ((Math.max(1, hubRound(round)) - 1) / (CEZERI_MAX_RESPINS - 1)));
/** Level of the tension bed's upper (urgent) layer: silent until respin 4, full from 8. */
export const tensionUpper = (round: number) => Math.max(0, Math.min(1, (hubRound(round) - 3) / 5));
/** Music duck under the chain (dB): 6 dB on the first respin, deepening to 14 dB. */
export const chainDuckDb = (round: number) => 6 + Math.min(8, Math.max(0, hubRound(round) - 1));

/** Hub reveal clip for the value the hub shows when a spin starts (×1 quiet … ×10 and above big). */
export type HubReveal = 'hub-x1' | 'hub-x2' | 'hub-x3' | 'hub-x5' | 'hub-x10';
export const hubRevealId = (value: number): HubReveal => (!(value >= 2) ? 'hub-x1' : value < 3 ? 'hub-x2' : value < 5 ? 'hub-x3' : value < 10 ? 'hub-x5' : 'hub-x10');

/** Highest callout class (≥ ×10) that `next` reaches and `previous` did not; null when no new class is reached. */
export function crossedClass(previous: number, next: number): MultiplierClass | null {
  if (!Number.isFinite(next) || next < 10) return null;
  const a = multiplierClass(Number.isFinite(previous) ? previous : 0), b = multiplierClass(next);
  return b !== a && multiplierRank(b) > multiplierRank(a) ? b : null;
}

/* ---------------- vessels and the reservoir ---------------- */

/** n-th vessel (scatter) of a spin, 1..6: each drip lands one ladder step higher (C D G A C D). */
export const vesselSemitones = (n: number) => ladder(Math.max(1, Math.min(6, Math.round(Number.isFinite(n) ? n : 1))) - 1);
/** Reservoir level 1..3 (Fil Saati): the float rises a fifth per level (C → G → D). */
export const RESERVOIR_STEPS: readonly number[] = Object.freeze([0, 7, 14]);
export const reservoirSemitones = (level: number) => RESERVOIR_STEPS[Math.max(1, Math.min(3, Math.round(Number.isFinite(level) ? level : 1))) - 1]!;

/* ---------------- callouts ---------------- */

export type CezeriCalloutClass = MultiplierClass;
export const CEZERI_CALLOUT_CLASSES: readonly CezeriCalloutClass[] = MULTIPLIER_CLASSES;
export const cezeriCalloutClass = (value: number): CezeriCalloutClass => multiplierClass(value);
export const cezeriCalloutRank = (c: CezeriCalloutClass) => multiplierRank(c);

/* ---------------- voice bank ---------------- */

/** Recorded voice lines (file stem → when). The intended words are in CEZERI_VOICE_TEXT (the engineer's warm, measured voice). */
export const CEZERI_VOICE_LINES = [
  'x10', 'x25', 'x50', 'x100', 'x250',
  'lock', 'chain-3', 'chain-6', 'chain-max',
  'scatter-tease', 'feature-trigger', 'feature-start', 'retrigger', 'reservoir', 'falcon',
  'win-big', 'win-mega', 'win-super', 'win-legend', 'win-max',
  'nice', 'feature-end',
] as const;
export type CezeriVoiceLine = (typeof CEZERI_VOICE_LINES)[number];

/** Suggested words per line (Turkish), for the voice script; the sound itself never needs them. */
export const CEZERI_VOICE_TEXT: Readonly<Record<CezeriVoiceLine, string>> = Object.freeze({
  x10: 'On kat!', x25: 'Yirmi beş kat!', x50: 'Elli kat!', x100: 'Yüz kat!', x250: 'İki yüz elli kat!',
  lock: 'Kenetlendi!', 'chain-3': 'Çarklar dönüyor!', 'chain-6': 'Dişliler hızlanıyor!', 'chain-max': 'Tam kurulum!',
  'scatter-tease': 'Bir su kabı daha…', 'feature-trigger': 'Su kapları doldu!', 'feature-start': 'Fil Saati başlıyor.', retrigger: 'Dört dönüş daha!',
  reservoir: 'Hazne doldu!', falcon: 'Şahin süzülüyor!',
  'win-big': 'Büyük kazanç!', 'win-mega': 'Mega kazanç!', 'win-super': 'Süper kazanç!', 'win-legend': 'Efsane kazanç!', 'win-max': 'Azami kazanç!',
  nice: 'Güzel!', 'feature-end': 'Saat tamamlandı.',
});

export const CEZERI_CLASS_VOICE: Readonly<Record<CezeriCalloutClass, CezeriVoiceLine | null>> = Object.freeze({ x2: null, x10: 'x10', x25: 'x25', x50: 'x50', x100: 'x100', x250: 'x250' });
export const CEZERI_TIER_VOICE: Readonly<Record<WinTier | 'max', CezeriVoiceLine>> = Object.freeze({ 1: 'win-big', 2: 'win-mega', 3: 'win-super', 4: 'win-legend', max: 'win-max' });
/** Chain milestone lines: respin 3, respin 6 and the full chain (10 respins). */
export const chainVoice = (round: number): CezeriVoiceLine | null => (round >= CEZERI_MAX_RESPINS ? 'chain-max' : round === 6 ? 'chain-6' : round === 3 ? 'chain-3' : null);

/** Non-verbal placeholder vocal ids (rendered effects: a wordless male voice) that stand in for a missing line; null = none. */
export type CezeriVocal = 'vo-hum' | 'vo-hey' | 'vo-joy';
export const CEZERI_PLACEHOLDER: Readonly<Record<CezeriVoiceLine, CezeriVocal | null>> = Object.freeze({
  x10: 'vo-hey', x25: 'vo-hey', x50: 'vo-joy', x100: 'vo-joy', x250: 'vo-joy',
  lock: null, 'chain-3': 'vo-hey', 'chain-6': 'vo-hey', 'chain-max': 'vo-joy',
  'scatter-tease': 'vo-hum', 'feature-trigger': 'vo-joy', 'feature-start': null, retrigger: 'vo-hey', reservoir: null, falcon: 'vo-hey',
  'win-big': 'vo-hey', 'win-mega': 'vo-hey', 'win-super': 'vo-joy', 'win-legend': 'vo-joy', 'win-max': 'vo-joy',
  nice: 'vo-hum', 'feature-end': 'vo-hum',
});

/** Priority of a line when two would overlap (higher replaces lower; equal or lower is skipped). */
export const CEZERI_VOICE_PRIORITY: Readonly<Record<CezeriVoiceLine, number>> = Object.freeze({
  x10: 4, x25: 5, x50: 6, x100: 7, x250: 8,
  lock: 1, 'chain-3': 3, 'chain-6': 4, 'chain-max': 7,
  'scatter-tease': 5, 'feature-trigger': 7, 'feature-start': 6, retrigger: 6, reservoir: 3, falcon: 4,
  'win-big': 6, 'win-mega': 7, 'win-super': 8, 'win-legend': 9, 'win-max': 10,
  nice: 1, 'feature-end': 6,
});

/** One voice at a time: play when free (or the current line is about to end), replace a lower-priority line, else skip. */
export function cezeriVoiceDecision(current: { line: CezeriVoiceLine; until: number } | null, next: CezeriVoiceLine, now: number, tolerance = 0.15): 'play' | 'replace' | 'skip' {
  if (!current || current.until - now <= tolerance) return 'play';
  return CEZERI_VOICE_PRIORITY[next] > CEZERI_VOICE_PRIORITY[current.line] ? 'replace' : 'skip';
}

/** URL per line: a folder (`/audio/voice/cezeri` → `/audio/voice/cezeri/x10.mp3`) or per-line URLs (blank = none). */
export function cezeriVoiceBankUrls(spec: string | Partial<Record<CezeriVoiceLine, string | null>>, ext = 'mp3'): Record<CezeriVoiceLine, string | null> {
  const out = {} as Record<CezeriVoiceLine, string | null>;
  for (const line of CEZERI_VOICE_LINES) {
    if (typeof spec === 'string') out[line] = spec.trim() ? versionedVoiceUrl(`${spec.trim().replace(/\/+$/, '')}/${line}.${ext}`) : null;
    else { const u = spec[line]; out[line] = typeof u === 'string' && u.trim() ? u : null; }
  }
  return out;
}

/** Load every line; any failure (missing file, network, decode) leaves that line null, silently. Never rejects. */
export async function loadCezeriVoiceBank<T>(urls: Record<CezeriVoiceLine, string | null>, load: (url: string) => Promise<T | null>): Promise<Map<CezeriVoiceLine, T | null>> {
  const entries = await Promise.all(CEZERI_VOICE_LINES.map(async line => {
    const url = urls[line];
    if (!url) return [line, null] as const;
    try { return [line, (await load(url)) ?? null] as const; } catch { return [line, null] as const; }
  }));
  return new Map(entries);
}
