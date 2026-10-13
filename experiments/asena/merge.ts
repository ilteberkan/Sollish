/** Merges per-mode evidence files written by simulate.ts (same engine hash, seed, workers) into one rtp.json.
 * Run: bash scripts/use-node.sh node --import tsx experiments/asena/merge.ts --out <rtp.json> <part1.json> <part2.json> ... */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const outAt = argv.indexOf("--out");
if (outAt < 0 || !argv[outAt + 1]) { console.error("usage: merge.ts --out PATH PART..."); process.exit(2); }
const out = argv[outAt + 1]!, parts = argv.filter((_, i) => i !== outAt && i !== outAt + 1);
if (parts.length === 0) { console.error("no parts"); process.exit(2); }
const files = parts.map(p => JSON.parse(readFileSync(resolve(p), "utf8")) as Record<string, any>);
const first = files[0]!;
for (const f of files) {
  for (const key of ["kind", "engine", "engineSourceSha256", "seed", "workers", "chunks", "betCentsSimulated", "tuningOverride"]) {
    if (JSON.stringify(f[key]) !== JSON.stringify(first[key])) throw new Error(`parts disagree on ${key}`);
  }
}
const modes: Record<string, unknown> = {};
for (const f of files) for (const [mode, report] of Object.entries(f.modes as Record<string, unknown>)) {
  if (mode in modes) throw new Error(`mode ${mode} appears twice`);
  modes[mode] = report;
}
const order = ["standard", "ante", "buy"];
const result = {
  ...first,
  modes: Object.fromEntries(order.filter(m => m in modes).map(m => [m, modes[m]])),
  runtimeSeconds: Number(files.reduce((a, f) => a + Number(f.runtimeSeconds), 0).toFixed(1)),
  mergedFrom: parts.length,
};
writeFileSync(resolve(out), JSON.stringify(result, null, 2) + "\n");
console.log(`merged ${Object.keys(modes).join(",")} into ${out}`);
