// Coordinator spectator check: mirror bouts (same model both corners), product format, fresh seed bank 9000+.
// Not a held-out performance evaluation; a product (watchability) measurement.
import { readFileSync, writeFileSync } from "node:fs";
import { createSparring, stepSparring, type SparringState } from "/Users/macmini/Desktop/Sollish/packages/protocol/src/combat-sparring.ts";
import { createNeuro2Memory, neuro2Input, neuro2Params } from "/Users/macmini/Desktop/Sollish/packages/protocol/src/neuro-boxer-2.ts";
import { createNeuroMemory, neuroInput } from "/Users/macmini/Desktop/Sollish/packages/protocol/src/neuro-boxer.ts";
import { NEURO_BOXER_GRAPH, NEURO_BOXER_PARAMS } from "/Users/macmini/Desktop/Sollish/packages/protocol/src/neuro-boxer-model.ts";
const [model = "s3", from = "9000", count = "60", out = ""] = process.argv.slice(2);
const theta = model === "v1" ? null : Float64Array.from(JSON.parse(readFileSync(`/Users/macmini/Desktop/Sollish/experiments/neuro-boxer/runs-v2/connectome-${model}/theta.json`, "utf8")).theta);
const p2 = theta ? neuro2Params(theta) : null;
const rows: Record<string, number | string | null>[] = [];
for (let seed = Number(from); seed < Number(from) + Number(count); seed++) {
  let s: SparringState = createSparring(seed, { durationSeconds: 45, rounds: 3, breakSeconds: 8 });
  const m2 = [createNeuro2Memory(), createNeuro2Memory()], m1 = [createNeuroMemory(), createNeuroMemory()];
  let firstAttack: number | null = null, r1Attacks = 0, hits = 0, blocks = 0, switches = 0; const styleTicks: Record<string, number> = {}; const last = [null, null] as (string | null)[];
  while (!s.finished) {
    const inputs = ([0, 1] as const).map(side => p2 ? neuro2Input(s, side, NEURO_BOXER_GRAPH, p2, m2[side]!, { temperature: .8 }) : neuroInput(s, side, NEURO_BOXER_GRAPH, NEURO_BOXER_PARAMS, m1[side]!, { temperature: .8 })) as unknown as [never, never];
    if (p2) for (const side of [0, 1]) { const st = m2[side]!.style; if (last[side] !== null && last[side] !== st) switches++; last[side] = st; if (s.phase === "fight") styleTicks[st] = (styleTicks[st] ?? 0) + 1; }
    s = stepSparring(s, inputs);
    for (const e of s.events) { if (e.type === "attack") { firstAttack ??= s.tick; if (s.round === 1) r1Attacks++; } if (e.type === "hit") hits++; if (e.type === "block") blocks++; }
  }
  const top = Object.entries(styleTicks).sort((a, b) => b[1] - a[1])[0];
  rows.push({ seed, winner: String(s.winner), method: s.method, ticks: s.tick, firstAttack, r1Attacks, hits, blocks, switches, topStyle: top ? top[0] : null, topShare: top ? +(top[1] / Object.values(styleTicks).reduce((a, b) => a + b, 0)).toFixed(3) : null });
}
const n = rows.length, mean = (k: string) => +(rows.reduce((t, r) => t + Number(r[k] ?? 0), 0) / n).toFixed(2), share = (f: (r: typeof rows[0]) => boolean) => +(rows.filter(f).length / n).toFixed(3);
const fa = rows.map(r => r.firstAttack as number | null).filter((x): x is number => x !== null).sort((a, b) => a - b);
const summary = { model, seeds: `${from}-${Number(from) + n - 1}`, bouts: n, drawShare: share(r => r.method === "draw"), koShare: share(r => r.method === "ko" || r.method === "tko"), decisionShare: share(r => r.method === "decision"),
  firstAttackTickMedian: fa.length ? fa[Math.floor(fa.length / 2)] : null, noAttackInRound1Share: share(r => (r.r1Attacks as number) === 0), r1AttacksMean: mean("r1Attacks"), hitsMean: mean("hits"), blocksMean: mean("blocks"), switchesPerBout: mean("switches"), boutSecondsMean: +(mean("ticks") / 60).toFixed(1),
  topStyles: Object.entries(rows.reduce((t, r) => { if (r.topStyle) t[r.topStyle as string] = (t[r.topStyle as string] ?? 0) + 1; return t; }, {} as Record<string, number>)) };
if (out) writeFileSync(out, JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary));
