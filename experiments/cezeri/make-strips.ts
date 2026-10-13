/** Generates the frozen ring strips of the Cezeri engine `cezeri-gears-1` from symbol COUNTS per ring.
 * Run: bash scripts/use-node.sh node --import tsx experiments/cezeri/make-strips.ts
 * Letters: A..D = h1..h4, E..H = l1..l4, W = gear (wild), V = vessel (scatter).
 * Procedure (deterministic, fixed seed text per ring): vessels are placed evenly around the circle (so no 12-slice window
 * can hold two), the other symbols are shuffled by a SplitMix32 stream (Fisher-Yates) and poured into the remaining
 * positions; the shuffle is repeated (next stream value) until no two identical symbols touch, circularly.
 * The output is pasted into BASE_STRIPS / FREE_STRIPS / FREE_STRIPS_BUY of packages/protocol/src/cezeri.ts; the engine does not call this file. */
import { createHash } from "node:crypto";

type Counts = Partial<Record<"A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "W" | "V", number>>;
export const SPEC: Record<"base" | "free" | "freeBuy", Counts[]> = {
  base: [
    { A: 2, B: 3, C: 3, D: 4, E: 5, F: 5, G: 6, H: 5, W: 1, V: 1 },
    { A: 2, B: 3, C: 4, D: 4, E: 6, F: 6, G: 6, H: 6, W: 1, V: 1 },
    { A: 3, B: 4, C: 4, D: 5, E: 6, F: 6, G: 7, H: 6, W: 1, V: 1 },
    { A: 3, B: 4, C: 5, D: 6, E: 7, F: 7, G: 7, H: 6, W: 1, V: 1 },
  ],
  free: [
    { A: 3, B: 4, C: 4, D: 4, E: 4, F: 4, G: 4, H: 3, W: 2, V: 1 },
    { A: 3, B: 4, C: 5, D: 5, E: 5, F: 5, G: 4, H: 3, W: 2, V: 1 },
    { A: 4, B: 5, C: 5, D: 5, E: 5, F: 5, G: 5, H: 4, W: 2, V: 1 },
    { A: 4, B: 5, C: 6, D: 6, E: 6, F: 6, G: 5, H: 4, W: 2, V: 1 },
  ],
  /** Free-spin strips of the buy mode (one gear less per ring: the guaranteed feature is priced at 100 x). */
  freeBuy: [
    { A: 3, B: 4, C: 4, D: 4, E: 4, F: 4, G: 4, H: 3, W: 1, V: 1 },
    { A: 3, B: 4, C: 5, D: 5, E: 5, F: 5, G: 4, H: 3, W: 1, V: 1 },
    { A: 4, B: 5, C: 5, D: 5, E: 5, F: 5, G: 5, H: 4, W: 1, V: 1 },
    { A: 4, B: 5, C: 6, D: 6, E: 6, F: 6, G: 5, H: 4, W: 1, V: 1 },
  ],
};

function splitMix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad); t ^= t >>> 15; t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export function makeStrip(counts: Counts, label: string): string {
  const vessels = counts.V ?? 0;
  const rest: string[] = [];
  for (const [letter, n] of Object.entries(counts)) if (letter !== "V") for (let i = 0; i < (n as number); i++) rest.push(letter);
  const length = rest.length + vessels;
  if (length < 30 || length > 48) throw new RangeError(`${label}: strip length ${length} outside 30..48`);
  if (vessels > 0 && Math.floor(length / vessels) < 12) throw new RangeError(`${label}: vessels closer than 12 slices`);
  const base = createHash("sha256").update(label).digest().readUInt32LE(0);
  const vesselAt = new Set<number>();
  for (let v = 0; v < vessels; v++) vesselAt.add(Math.floor((v * length) / vessels));
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const rng = splitMix32(base + attempt);
    const deck = rest.slice();
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1) / 4_294_967_296); [deck[i], deck[j]] = [deck[j]!, deck[i]!]; }
    const out: string[] = [];
    let d = 0;
    for (let i = 0; i < length; i++) out.push(vesselAt.has(i) ? "V" : deck[d++]!);
    if (out.every((c, i) => c !== out[(i + 1) % length])) return out.join("");
  }
  throw new Error(`${label}: no arrangement without touching equals`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const kind of ["base", "free", "freeBuy"] as const) {
    const strips = SPEC[kind].map((counts, ring) => makeStrip(counts, `cezeri-gears-1:${kind}:ring${ring}`));
    console.log(`${kind.toUpperCase()}_STRIPS = ${JSON.stringify(strips)}`);
    strips.forEach((s, ring) => console.log(`  ring ${ring}: length ${s.length} ${s}`));
  }
}
