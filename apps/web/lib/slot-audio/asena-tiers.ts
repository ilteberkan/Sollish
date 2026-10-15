/**
 * Pure logic for the Asena: Yıldız Kurdu sound: the constellation trace plan (one star note per lighting event of the
 * stroke plan, a distinct rising motif per template, harmony for nodes that light together, the ignition and the howl
 * that resolve it), pitch maps for symbols, landing columns, moons and map pieces, the wolf-walk paw timing, the
 * multiplier callout classes, the recorded voice bank (file names, Turkish texts of the wise female sky voice), the
 * non-verbal placeholders and the one-voice-at-a-time policy. No Web Audio here, so it is unit tested in Node.
 * Presentation only: nothing here reads or changes a result; it only maps already-resolved steps
 * (packages/protocol/src/asena.ts) and the art layer's stroke plan (components/asena/geometry.ts) to sound parameters.
 */
import { MULTIPLIER_CLASSES, multiplierClass, multiplierRank, type MultiplierClass, type WinTier } from './win-tiers';

/** Tonic (MIDI) of the Asena base key: E (E Hüseyni). Celebration tiers climb from here by TIER_KEY (E → F# → G# → B → C#). */
export const ASENA_TONIC = 52;
/**
 * The E minor pentatonic ladder (E G A B D — the Central-Asian anhemitonic scale) in semitones around E5. It is
 * consonant with the base theme (E Hüseyni: E F# G A B C# D), the feature theme (B Kürdi: B C D E F# G A, turning to
 * E Hüseyni in its B section) and the throat drone's harmonics, so every data-driven pitch stays in key in every scene.
 */
export const ASENA_LADDER: readonly number[] = Object.freeze([-24, -21, -19, -17, -14, -12, -9, -7, -5, -2, 0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24]);
const LADDER_ZERO = ASENA_LADDER.indexOf(0);
const finite = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** Ladder step `k` (0 = E5) → semitones; clamped to the ladder. */
export const ladder = (k: number) => ASENA_LADDER[Math.max(0, Math.min(ASENA_LADDER.length - 1, LADDER_ZERO + Math.round(finite(k))))]!;
/** Ladder index of a semitone value (nearest at or below). */
const indexOf = (semi: number) => { let k = 0; for (let i = 0; i < ASENA_LADDER.length; i++) if (ASENA_LADDER[i]! <= semi + 1e-9) k = i; return k; };

/* ---------------- symbols, columns, moons ---------------- */

export type AsenaSymbolId = 'h1' | 'h2' | 'h3' | 'h4' | 'l1' | 'l2' | 'l3' | 'l4' | 'wolf' | 'trail';
export const ASENA_SYMBOL_IDS: readonly AsenaSymbolId[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4'];
/** Burst / win pitch by symbol (semitones above the burst clip's E): h1 Asena highest, eight distinct ladder tones; wilds sit on E. */
export const SYMBOL_SEMITONES: Readonly<Record<AsenaSymbolId, number>> = Object.freeze({ h1: 10, h2: 7, h3: 5, h4: 3, l1: 0, l2: -2, l3: -5, l4: -7, wolf: 0, trail: 0 });
export const symbolSemitones = (s: string | null | undefined) => (s && s in SYMBOL_SEMITONES ? SYMBOL_SEMITONES[s as AsenaSymbolId] : 0);

/** Burst size class: 5–7 cells small, 8–11 medium, 12+ large. */
export type BurstSize = 's' | 'm' | 'l';
export const burstSize = (cells: number): BurstSize => (!(cells >= 8) ? 's' : cells >= 12 ? 'l' : 'm');

/** Landing columns 0..5 (left → right) → B D E G A B: the drops play a rising pentatonic phrase across the board. */
export const COLUMN_STEPS: readonly number[] = Object.freeze([-5, -2, 0, 3, 5, 7]);
export const columnSemitones = (col: number) => COLUMN_STEPS[Math.max(0, Math.min(5, Math.round(finite(col))))]!;
export const columnPan = (col: number) => +((Math.max(0, Math.min(5, Math.round(finite(col)))) - 2.5) / 3.6).toFixed(4);

/* ---------------- constellations ---------------- */

export type AsenaTemplateId = 'kurt-basi' | 'yay' | 'at' | 'kartal' | 'hayat-agaci' | 'hilal';
export const ASENA_TEMPLATE_ORDER: readonly AsenaTemplateId[] = ['kurt-basi', 'yay', 'at', 'kartal', 'hayat-agaci', 'hilal'];
export const ASENA_TEMPLATE_MULTIPLIER: Readonly<Record<AsenaTemplateId, number>> = Object.freeze({ 'kurt-basi': 10, yay: 3, at: 4, kartal: 6, 'hayat-agaci': 8, hilal: 2 });
export const isTemplateId = (id: unknown): id is AsenaTemplateId => typeof id === 'string' && (ASENA_TEMPLATE_ORDER as readonly string[]).includes(id);

/**
 * The melodic motif of each template: one note (semitones around E5, on the ladder) per lighting event, rising, each
 * template with its own contour so the shapes are told apart by ear:
 *   hilal ×2       B4 D5 E5            a small crescent of steps
 *   yay ×3         E5 G5 A5 → E6        the bow drawn tight, then the arrow leaps an octave
 *   at ×4          B4 D5 E5 G5 A5 B5    a stepwise gallop up the scale
 *   kartal ×6      E4 B4 B5 E6          wide wing-beat leaps (fifth, octave, fourth)
 *   hayat-agaci ×8 E4 A4 D5 G5 B5       stacked fourths from the root up the trunk, the crown a chord
 *   kurt-basi ×10  E5 G5 B5 D6 E6       the Asena call — the base theme's opening arpeggio — into the howl
 */
export const ASENA_MOTIFS: Readonly<Record<AsenaTemplateId, readonly number[]>> = Object.freeze({
  hilal: [-5, -2, 0], yay: [0, 3, 5, 12], at: [-5, -2, 0, 3, 5, 7], kartal: [-12, -5, 7, 12], 'hayat-agaci': [-12, -7, -2, 3, 7], 'kurt-basi': [0, 3, 7, 10, 12],
});
/** Howl pitch per template (semitones from the howl clip's E5): the call continues where the motif ended. */
export const HOWL_SEMITONES: Readonly<Record<AsenaTemplateId, number>> = Object.freeze({ hilal: -5, yay: 0, at: -2, kartal: 3, 'hayat-agaci': 0, 'kurt-basi': 3 });
/**
 * Lighting groups of each template's stroke plan (node count per lighting event, in order), as produced by
 * components/asena/geometry.ts asenaConstellationPlan for its authored stroke graphs (equal for every transform: the
 * symmetries keep edge lengths). Used when the caller passes no plan times.
 */
export const DEFAULT_GROUPS: Readonly<Record<AsenaTemplateId, readonly number[]>> = Object.freeze({
  'kurt-basi': [1, 1, 2, 2, 1], yay: [1, 2, 2, 1], at: [1, 1, 1, 1, 1, 1], kartal: [1, 2, 2, 2], 'hayat-agaci': [1, 1, 1, 1, 3], hilal: [1, 2, 2],
});
/** Default trace length (ms) of the art layer's plan. */
export const TRACE_MS = 1400;
/** Nodes whose plan times are this close (ms) light together and sound as one chord. */
export const GROUP_TOLERANCE_MS = 30;
/** The howl begins this long after the plan's end (the ignition bloom speaks first). */
export const HOWL_DELAY = 0.16;

/** Star-node clips, rendered at E4, E5 and E6: each note uses the nearest one, so no clip moves more than half an octave. */
export const NODE_CLIPS = [{ id: 'node-lo', semitones: -12 }, { id: 'node', semitones: 0 }, { id: 'node-hi', semitones: 12 }] as const;
export type NodeClip = (typeof NODE_CLIPS)[number]['id'];
export function nodeClipFor(semitones: number): { clip: NodeClip; rate: number } {
  const s = finite(semitones);
  let best: (typeof NODE_CLIPS)[number] = NODE_CLIPS[0];
  for (const c of NODE_CLIPS) if (Math.abs(s - c.semitones) < Math.abs(s - best.semitones) - 1e-9) best = c;
  return { clip: best.id, rate: 2 ** ((s - best.semitones) / 12) };
}

export interface TraceNote { node: number; semitones: number; clip: NodeClip; rate: number; gain: number; pan: number }
export interface TraceEvent { index: number; at: number; notes: TraceNote[] }
export interface ConstellationTrace {
  templateId: AsenaTemplateId; multiplier: number;
  /** Length of the visual trace (s). */
  seconds: number;
  events: TraceEvent[];
  /** When the ignition bloom starts (s, = the plan end). */
  igniteAt: number;
  /** When the howl starts (s). */
  howlAt: number;
  /** Howl playback rate. */
  howlRate: number;
}

/**
 * The constellation as sound: `nodeAtMs` (the art plan's per-node lighting times, template cell order) are grouped into
 * lighting events; event k plays the template motif's k-th note (the motif continues up the ladder if a plan has more
 * events), and every further node of the same event adds a harmony two ladder steps lower per node (a fourth/fifth
 * below), so branches that draw together ring as chords. Without plan times the template's default groups are spread
 * over `durationMs`. Columns of the board (`cols`, optional, same order as the nodes) place each star left/right.
 * Non-finite input is cleaned; an unknown template falls back to hilal.
 */
export function constellationTrace(templateId: string, nodeAtMs?: readonly number[] | null, durationMs = TRACE_MS, cols?: readonly number[] | null): ConstellationTrace {
  const id: AsenaTemplateId = isTemplateId(templateId) ? templateId : 'hilal';
  const motif = ASENA_MOTIFS[id];
  const dur = Math.max(200, Math.min(6000, finite(durationMs, TRACE_MS)));
  let times: number[];
  if (nodeAtMs && nodeAtMs.length) times = nodeAtMs.map(t => Math.max(0, Math.min(dur, finite(t))));
  else {
    const groups = DEFAULT_GROUPS[id], n = groups.length;
    times = groups.flatMap((size, k) => Array.from({ length: size }, () => (n > 1 ? (k / (n - 1)) * dur : 0)));
  }
  const order = times.map((t, node) => ({ t, node })).sort((a, b) => a.t - b.t || a.node - b.node);
  const events: TraceEvent[] = [];
  for (const o of order) {
    const last = events[events.length - 1];
    if (last && o.t - last.at * 1000 <= GROUP_TOLERANCE_MS) last.notes.push({ node: o.node, semitones: 0, clip: 'node', rate: 1, gain: 1, pan: 0 });
    else events.push({ index: events.length, at: o.t / 1000, notes: [{ node: o.node, semitones: 0, clip: 'node', rate: 1, gain: 1, pan: 0 }] });
  }
  const top = motif[motif.length - 1]!;
  for (const ev of events) {
    const lead = ev.index < motif.length ? motif[ev.index]! : ladder(indexOf(top) - LADDER_ZERO + (ev.index - motif.length + 1));
    ev.notes.forEach((n, j) => {
      const semi = j === 0 ? lead : ladder(indexOf(lead) - LADDER_ZERO - 2 * j);
      const { clip, rate } = nodeClipFor(semi);
      const col = cols && Number.isFinite(cols[n.node]) ? cols[n.node]! : null;
      n.semitones = semi; n.clip = clip; n.rate = rate;
      n.gain = (j === 0 ? 1 : 0.62 / Math.sqrt(j)) * (0.78 + 0.22 * (ev.index / Math.max(1, events.length - 1)));
      n.pan = col === null ? (j % 2 ? 0.25 : -0.25) * (j ? 1 : 0) : columnPan(col);
    });
  }
  const seconds = dur / 1000;
  return { templateId: id, multiplier: ASENA_TEMPLATE_MULTIPLIER[id], seconds, events, igniteAt: seconds, howlAt: seconds + HOWL_DELAY, howlRate: 2 ** (HOWL_SEMITONES[id] / 12) };
}

/* ---------------- wolf walk, map, Ergenekon ---------------- */

/** Paw steps of one wolf walk (seconds from its start) over the animation length: a four-beat trot that lands on the target. */
export function pawTimes(ms: number): number[] {
  const s = Math.max(0.2, Math.min(2.5, finite(ms, 640) / 1000));
  return [0.06, 0.3, 0.55, 0.82].map(x => +(x * s).toFixed(4));
}

/** Map piece pitch (semitones above the piece clip's E5) by template index 0..5 (kurt-basi … hilal): Kurt Başı highest,
 *  Hilal lowest, six distinct ladder tones; the second piece of a template sits one ladder step higher. */
export const PIECE_STEPS: readonly number[] = Object.freeze([4, 0, 1, 2, 3, -1]);
export function pieceSemitones(template: number, count = 1): number {
  const t = Math.max(0, Math.min(5, Math.round(finite(template))));
  return ladder(PIECE_STEPS[t]! + (finite(count, 1) >= 2 ? 1 : 0));
}

/** Global multiplier class of the Ergenekon map: ×2 → 1, ×3 → 2, ×5 → 3 (the iron mountain cracks wider each time). */
export function mountainLevel(multiplier: number): 0 | 1 | 2 | 3 {
  const m = finite(multiplier, 1);
  return m >= 5 ? 3 : m >= 3 ? 2 : m >= 2 ? 1 : 0;
}

/* ---------------- callouts ---------------- */

export type AsenaCalloutClass = MultiplierClass;
export const ASENA_CALLOUT_CLASSES: readonly AsenaCalloutClass[] = MULTIPLIER_CLASSES;
export const asenaCalloutClass = (value: number): AsenaCalloutClass => multiplierClass(value);
export const asenaCalloutRank = (c: AsenaCalloutClass) => multiplierRank(c);

/* ---------------- voice bank ---------------- */

/** Recorded voice lines (file stem → when). The intended words are in ASENA_VOICE_TEXT: an original wise female sky voice. */
export const ASENA_VOICE_LINES = [
  'x2-9', 'x10', 'x25', 'x50', 'x100', 'x250',
  'sky-open', 'tpl-kurt-basi', 'tpl-yay', 'tpl-at', 'tpl-kartal', 'tpl-hayat-agaci', 'tpl-hilal', 'wolf-guides',
  'moon-tease', 'feature-trigger', 'feature-start', 'retrigger', 'map-spins', 'mult-2', 'mult-3', 'mult-5',
  'win-big', 'win-mega', 'win-super', 'win-legend', 'win-max', 'nice', 'feature-end',
] as const;
export type AsenaVoiceLine = (typeof ASENA_VOICE_LINES)[number];

/** Suggested words per line (Turkish), for the voice script; the sound itself never needs them. */
export const ASENA_VOICE_TEXT: Readonly<Record<AsenaVoiceLine, string>> = Object.freeze({
  'x2-9': 'Parlıyor!', x10: 'On kat!', x25: 'Yirmi beş kat!', x50: 'Elli kat!', x100: 'Yüz kat!', x250: 'İki yüz elli kat!',
  'sky-open': 'Gök açıldı!', 'tpl-kurt-basi': 'Kurt Başı!', 'tpl-yay': 'Yay gerildi!', 'tpl-at': 'At koşuyor!', 'tpl-kartal': 'Kartal kanatlandı!', 'tpl-hayat-agaci': 'Hayat Ağacı!', 'tpl-hilal': 'Hilal doğdu.',
  'wolf-guides': 'Kurt yol gösteriyor…',
  'moon-tease': 'Ay Ata bakıyor…', 'feature-trigger': 'Ay Ata uyandı!', 'feature-start': 'Ergenekon!', retrigger: 'Üç dönüş daha!', 'map-spins': 'Beş dönüş daha!',
  'mult-2': 'Demir dağ çatlıyor! İki kat!', 'mult-3': 'Dağ eriyor! Üç kat!', 'mult-5': 'Ergenekon açıldı! Beş kat!',
  'win-big': 'Büyük kazanç!', 'win-mega': 'Mega kazanç!', 'win-super': 'Süper kazanç!', 'win-legend': 'Efsane kazanç!', 'win-max': 'Azami kazanç!',
  nice: 'Güzel!', 'feature-end': 'Ergenekon’dan çıktık!',
});

export const ASENA_CLASS_VOICE: Readonly<Record<AsenaCalloutClass, AsenaVoiceLine>> = Object.freeze({ x2: 'x2-9', x10: 'x10', x25: 'x25', x50: 'x50', x100: 'x100', x250: 'x250' });
export const ASENA_TIER_VOICE: Readonly<Record<WinTier | 'max', AsenaVoiceLine>> = Object.freeze({ 1: 'win-big', 2: 'win-mega', 3: 'win-super', 4: 'win-legend', max: 'win-max' });
export const ASENA_TEMPLATE_VOICE: Readonly<Record<AsenaTemplateId, AsenaVoiceLine>> = Object.freeze({
  'kurt-basi': 'tpl-kurt-basi', yay: 'tpl-yay', at: 'tpl-at', kartal: 'tpl-kartal', 'hayat-agaci': 'tpl-hayat-agaci', hilal: 'tpl-hilal',
});
export const ASENA_MOUNTAIN_VOICE: Readonly<Record<1 | 2 | 3, AsenaVoiceLine>> = Object.freeze({ 1: 'mult-2', 2: 'mult-3', 3: 'mult-5' });

/** Non-verbal placeholder vocal ids (rendered effects: a wordless sky voice) that stand in for a missing line; null = none. */
export type AsenaVocal = 'vo-breath' | 'vo-call' | 'vo-joy';
export const ASENA_PLACEHOLDER: Readonly<Record<AsenaVoiceLine, AsenaVocal | null>> = Object.freeze({
  'x2-9': null, x10: 'vo-call', x25: 'vo-call', x50: 'vo-joy', x100: 'vo-joy', x250: 'vo-joy',
  'sky-open': 'vo-call', 'tpl-kurt-basi': null, 'tpl-yay': null, 'tpl-at': null, 'tpl-kartal': null, 'tpl-hayat-agaci': null, 'tpl-hilal': null, 'wolf-guides': null,
  'moon-tease': 'vo-breath', 'feature-trigger': 'vo-joy', 'feature-start': null, retrigger: 'vo-call', 'map-spins': null,
  'mult-2': 'vo-call', 'mult-3': 'vo-joy', 'mult-5': 'vo-joy',
  'win-big': 'vo-call', 'win-mega': 'vo-call', 'win-super': 'vo-joy', 'win-legend': 'vo-joy', 'win-max': 'vo-joy',
  nice: 'vo-breath', 'feature-end': 'vo-breath',
});

/** Priority of a line when two would overlap (higher replaces lower; equal or lower is skipped). */
export const ASENA_VOICE_PRIORITY: Readonly<Record<AsenaVoiceLine, number>> = Object.freeze({
  'x2-9': 2, x10: 4, x25: 5, x50: 6, x100: 7, x250: 8,
  'sky-open': 3, 'tpl-kurt-basi': 4, 'tpl-yay': 3, 'tpl-at': 3, 'tpl-kartal': 3, 'tpl-hayat-agaci': 4, 'tpl-hilal': 3, 'wolf-guides': 1,
  'moon-tease': 5, 'feature-trigger': 7, 'feature-start': 6, retrigger: 6, 'map-spins': 5, 'mult-2': 6, 'mult-3': 7, 'mult-5': 8,
  'win-big': 6, 'win-mega': 7, 'win-super': 8, 'win-legend': 9, 'win-max': 10, nice: 1, 'feature-end': 6,
});

/** One voice at a time: play when free (or the current line is about to end), replace a lower-priority line, else skip. */
export function asenaVoiceDecision(current: { line: AsenaVoiceLine; until: number } | null, next: AsenaVoiceLine, now: number, tolerance = 0.15): 'play' | 'replace' | 'skip' {
  if (!current || current.until - now <= tolerance) return 'play';
  return ASENA_VOICE_PRIORITY[next] > ASENA_VOICE_PRIORITY[current.line] ? 'replace' : 'skip';
}

/** URL per line: a folder (`/audio/voice/asena` → `/audio/voice/asena/x10.mp3`) or per-line URLs (blank = none). */
export function asenaVoiceBankUrls(spec: string | Partial<Record<AsenaVoiceLine, string | null>>, ext = 'mp3'): Record<AsenaVoiceLine, string | null> {
  const out = {} as Record<AsenaVoiceLine, string | null>;
  for (const line of ASENA_VOICE_LINES) {
    if (typeof spec === 'string') out[line] = spec.trim() ? `${spec.trim().replace(/\/+$/, '')}/${line}.${ext}` : null;
    else { const u = spec[line]; out[line] = typeof u === 'string' && u.trim() ? u : null; }
  }
  return out;
}

/** Load every line; any failure (missing file, network, decode) leaves that line null, silently. Never rejects. */
export async function loadAsenaVoiceBank<T>(urls: Record<AsenaVoiceLine, string | null>, load: (url: string) => Promise<T | null>): Promise<Map<AsenaVoiceLine, T | null>> {
  const entries = await Promise.all(ASENA_VOICE_LINES.map(async line => {
    const url = urls[line];
    if (!url) return [line, null] as const;
    try { return [line, (await load(url)) ?? null] as const; } catch { return [line, null] as const; }
  }));
  return new Map(entries);
}
