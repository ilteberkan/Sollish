/**
 * Tiny text notation for writing scores by hand, plus chord symbols and voice leading.
 *
 * Melody:  "C5:.5 F5:.5 A5:1 r:.5 Bb4:.5@.7 | ..."  — note:beats[@velocity], `r` is a rest, `|` is a bar line.
 * Drums:   "x...o...X...g..."                       — 16 steps per bar; X accent, x normal, o soft, g ghost.
 * Chords:  "Fmaj7 | Am7 D7 | Gm7:3 C7:1"            — one or more chords per bar, optional beat lengths.
 */

export interface NoteEvent { t: number; d: number; n: number; v: number }
export interface ChordEvent { t: number; d: number; symbol: string; root: number; tones: number[]; bass: number }
export interface HitEvent { t: number; k: string; v: number }

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "F#5" → 78 (MIDI, C4 = 60). */
export function noteToMidi(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`bad note "${name}"`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + LETTER[m[1]!]! + acc;
}

export function pitchClass(name: string): number {
  const m = /^([A-G])(#|b)?$/.exec(name);
  if (!m) throw new Error(`bad pitch class "${name}"`);
  return (LETTER[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

/** Parse a melody; every bar must add up to exactly `beatsPerBar` beats (checked, so typos fail loudly). */
export function melody(src: string, startBar = 0, beatsPerBar = 4, transpose = 0): NoteEvent[] {
  const out: NoteEvent[] = [];
  const bars = src.split('|').map(b => b.trim()).filter(b => b.length > 0);
  bars.forEach((bar, bi) => {
    let t = 0;
    for (const token of bar.split(/\s+/)) {
      const m = /^([A-Gr][#b]?-?\d?):(\d*\.?\d+)(?:@(\d*\.?\d+))?$/.exec(token);
      if (!m) throw new Error(`bad token "${token}" in bar ${startBar + bi + 1}`);
      const d = Number(m[2]);
      if (m[1] !== 'r') out.push({ t: (startBar + bi) * beatsPerBar + t, d, n: noteToMidi(m[1]!) + transpose, v: m[3] ? Number(m[3]) : 0.8 });
      t += d;
    }
    if (Math.abs(t - beatsPerBar) > 1e-9) throw new Error(`bar ${startBar + bi + 1} has ${t} beats, expected ${beatsPerBar}`);
  });
  return out;
}

/** Number of bars a melody string spans. */
export const barCount = (src: string) => src.split('|').map(b => b.trim()).filter(Boolean).length;

const STEP_VELOCITY: Record<string, number> = { X: 1, x: 0.82, o: 0.55, g: 0.3 };

/** A 16-step drum line repeated over `bars` bars starting at `startBar`. */
export function steps(kind: string, pattern: string, startBar: number, bars = 1, gain = 1): HitEvent[] {
  const clean = pattern.replace(/\s+/g, '');
  if (clean.length !== 16) throw new Error(`drum pattern for ${kind} must have 16 steps, got ${clean.length}`);
  const out: HitEvent[] = [];
  for (let b = 0; b < bars; b++) for (let s = 0; s < 16; s++) {
    const v = STEP_VELOCITY[clean[s]!];
    if (v) out.push({ t: (startBar + b) * 4 + s / 4, k: kind, v: v * gain });
  }
  return out;
}

const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], dim7: [0, 3, 6, 9],
  m6: [0, 3, 7, 9], '6': [0, 4, 7, 9], sus4: [0, 5, 7], '7sus4': [0, 5, 7, 10], '9': [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], m7b5: [0, 3, 6, 10], '7b9': [0, 4, 7, 10, 13], '6add9': [0, 4, 7, 9, 14],
};

/** "Gm7/Bb" → root 7, tones [7,10,2,5], bass 10. */
export function parseChord(symbol: string): { root: number; tones: number[]; bass: number } {
  const [main, slash] = symbol.split('/');
  const m = /^([A-G][#b]?)(.*)$/.exec(main!);
  if (!m) throw new Error(`bad chord "${symbol}"`);
  const q = QUALITIES[m[2]!];
  if (!q) throw new Error(`unknown chord quality "${m[2]}" in "${symbol}"`);
  const root = pitchClass(m[1]!);
  return { root, tones: q.map(i => (root + i) % 12), bass: slash ? pitchClass(slash) : root };
}

export function progression(src: string, startBar = 0, beatsPerBar = 4): ChordEvent[] {
  const out: ChordEvent[] = [];
  src.split('|').map(b => b.trim()).filter(Boolean).forEach((bar, bi) => {
    const items = bar.split(/\s+/).map(s => { const [symbol, len] = s.split(':'); return { symbol: symbol!, len: len ? Number(len) : NaN }; });
    const fixed = items.filter(i => !Number.isNaN(i.len)).reduce((s, i) => s + i.len, 0);
    const free = items.filter(i => Number.isNaN(i.len)).length;
    const each = free ? (beatsPerBar - fixed) / free : 0;
    let t = 0;
    for (const item of items) {
      const d = Number.isNaN(item.len) ? each : item.len;
      out.push({ t: (startBar + bi) * beatsPerBar + t, d, symbol: item.symbol, ...parseChord(item.symbol) });
      t += d;
    }
    if (Math.abs(t - beatsPerBar) > 1e-9) throw new Error(`chord bar ${startBar + bi + 1} has ${t} beats`);
  });
  return out;
}

/**
 * Smooth voicing: `count` chord tones inside [lo, hi], each placed nearest to the previous voicing's
 * centre; colour tones (3rd, 7th, extensions) win over the root and fifth when there is no room.
 */
export function voice(tones: number[], count: number, lo: number, hi: number, previous: number[] | null): number[] {
  const centre = previous && previous.length ? previous.reduce((s, n) => s + n, 0) / previous.length : (lo + hi) / 2;
  const priority = [...tones.slice(1), tones[0]!];
  if (tones.length >= 4) { const fifth = tones[2]!; priority.splice(priority.indexOf(fifth), 1); priority.push(fifth); }
  const picked: number[] = [];
  for (const pc of priority) {
    if (picked.length >= count) break;
    let best = -1, dist = Infinity;
    for (let n = lo; n <= hi; n++) if (n % 12 === pc && !picked.includes(n)) { const d = Math.abs(n - centre); if (d < dist) { dist = d; best = n; } }
    if (best >= 0) picked.push(best);
  }
  // fill with doublings if the chord has fewer tones than voices
  let k = 0;
  while (picked.length < count && k < 24) {
    const pc = tones[k % tones.length]!; k++;
    for (let n = hi; n >= lo; n--) if (n % 12 === pc && !picked.includes(n)) { picked.push(n); break; }
  }
  return picked.sort((a, b) => a - b);
}

/** Nearest MIDI note with pitch class `pc` to `target`. */
export function nearest(pc: number, target: number): number {
  const base = target - (((target - pc) % 12) + 12) % 12;
  return target - base > 6 ? base + 12 : base;
}
