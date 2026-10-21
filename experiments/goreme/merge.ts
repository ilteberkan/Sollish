/** Merges per-mode evidence files written by simulate.ts (same engine hash, seed, workers, chunks) into one rtp.json.
 * Run: bash scripts/use-node.sh node --import tsx experiments/goreme/merge.ts --out <rtp.json> <mode-standard.json> <mode-ante.json> <mode-buy.json>
 * Partial report from the chunk checkpoints of an unfinished run (marked "partial": true, never evidence):
 *      bash scripts/use-node.sh node --import tsx experiments/goreme/merge.ts --partial <out>.ckpt --mode standard --out <partial.json> */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildModeReport, type Part } from "./simulate.ts";
import { GOREME_MODES, type GoremeMode } from "../../packages/protocol/src/goreme.ts";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => { const at = argv.indexOf(`--${name}`); return at >= 0 ? argv[at + 1] : undefined; };
const out = flag("out");
if (!out) { console.error("usage: merge.ts --out PATH PART... | merge.ts --partial CKPT_DIR --mode MODE --out PATH"); process.exit(2); }
const partialDir = flag("partial");
if (partialDir) {
  const mode = flag("mode") as GoremeMode;
  if (!GOREME_MODES.includes(mode)) { console.error("--mode must be standard, ante or buy"); process.exit(2); }
  const files = readdirSync(resolve(partialDir)).filter(f => f.startsWith(`${mode}-`) && f.endsWith(".json")).sort();
  const saved = files.map(f => JSON.parse(readFileSync(resolve(partialDir, f), "utf8")) as { engineSourceSha256: string; seed: string; tuning: unknown; parts: Part[] });
  if (saved.length === 0) { console.error("no checkpoints"); process.exit(2); }
  if (new Set(saved.map(s => s.engineSourceSha256)).size !== 1 || new Set(saved.map(s => JSON.stringify(s.tuning))).size !== 1) throw new Error("checkpoints disagree on engine or tuning");
  const report = { kind: "goreme-rtp-simulation", partial: true, engineSourceSha256: saved[0]!.engineSourceSha256, tuningOverride: saved[0]!.tuning, chunkFiles: files, modes: { [mode]: buildModeReport(saved.flatMap(s => s.parts), mode) } };
  writeFileSync(resolve(out), JSON.stringify(report, null, 2) + "\n");
  console.log(`partial ${mode}: ${files.length} chunk files into ${out}`);
} else {
  const parts = argv.filter((_, i) => argv[i - 1] !== "--out" && argv[i] !== "--out");
  if (parts.length === 0) { console.error("no parts"); process.exit(2); }
  const files = parts.map(p => JSON.parse(readFileSync(resolve(p), "utf8")) as Record<string, any>);
  const first = files[0]!;
  for (const f of files) {
    if (f.partial) throw new Error("a partial report cannot be merged into evidence");
    for (const key of ["kind", "engine", "engineSourceSha256", "seed", "workers", "chunks", "betCentsSimulated", "tuningOverride"]) {
      if (JSON.stringify(f[key]) !== JSON.stringify(first[key])) throw new Error(`parts disagree on ${key}`);
    }
  }
  const modes: Record<string, unknown> = {};
  for (const f of files) for (const [mode, report] of Object.entries(f.modes as Record<string, unknown>)) {
    if (mode in modes) throw new Error(`mode ${mode} appears twice`);
    modes[mode] = report;
  }
  const result = {
    ...first,
    modes: Object.fromEntries(GOREME_MODES.filter(m => m in modes).map(m => [m, modes[m]])),
    runtimeSeconds: Number(files.reduce((a, f) => a + Number(f.runtimeSeconds), 0).toFixed(1)),
    mergedFrom: parts.length,
  };
  writeFileSync(resolve(out), JSON.stringify(result, null, 2) + "\n");
  console.log(`merged ${Object.keys(modes).join(",")} into ${out}`);
}
