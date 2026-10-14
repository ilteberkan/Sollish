/** Evidence driver for `cezeri-gears-1`: runs simulate.ts once per mode (separate process, own output file), skips a mode whose part
 * file already exists for the CURRENT engine sha, then merges the parts into rtp.json.
 * Run: bash scripts/use-node.sh node --import tsx experiments/cezeri/run-evidence.ts [--rounds 20000000] [--seed cezeri-20261012-evidence] [--workers 2] [--dir ops/evidence/cezeri-20261012]
 * A part is ops/evidence/cezeri-20261012/parts/rtp-<mode>.json; it is the normal simulate.ts output restricted to one mode. The merge refuses parts
 * with a different engine sha, seed, rounds, worker count or a tuning override. Delete a part file to force a rerun of that mode. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
const rounds = Number(args.get("rounds") ?? 20_000_000), seed = args.get("seed") ?? "cezeri-20261012-evidence", workers = Number(args.get("workers") ?? 2);
const dir = resolve(args.get("dir") ?? resolve(here, "../../ops/evidence/cezeri-20261012"));
const MODES = ["standard", "ante", "buy"] as const;
const source = readFileSync(resolve(here, "../../packages/protocol/src/cezeri.ts"), "utf8").replace(/\/\/ @evidence-block-begin[^\n]*\n[\s\S]*?\/\/ @evidence-block-end\n/, "");
const sha = createHash("sha256").update(source).digest("hex");
mkdirSync(resolve(dir, "parts"), { recursive: true });

interface Part { engineSourceSha256: string; seed: string; workers: number; tuningOverride: unknown; modes: Record<string, { rounds: number }> ; [key: string]: unknown }
const partFile = (mode: string): string => resolve(dir, "parts", `rtp-${mode}.json`);
const readPart = (mode: string): Part | null => { try { return JSON.parse(readFileSync(partFile(mode), "utf8")) as Part; } catch { return null; } };
const fresh = (p: Part | null, mode: string): boolean => !!p && p.engineSourceSha256 === sha && p.seed === seed && p.workers === workers && p.tuningOverride === null && p.modes[mode]?.rounds === rounds;

for (const mode of MODES) {
  if (fresh(readPart(mode), mode)) { console.log(`${mode}: part is current for engine sha ${sha.slice(0, 12)}, skipped`); continue; }
  console.log(`${mode}: running ${rounds} rounds ...`);
  const run = spawnSync(process.execPath, [...process.execArgv.filter(a => a !== ""), resolve(here, "simulate.ts"), "--rounds", String(rounds), "--seed", seed, "--out", partFile(mode), "--modes", mode, "--workers", String(workers)], { stdio: "inherit" });
  if (run.status !== 0) { console.error(`${mode}: simulate.ts failed (${run.status})`); process.exit(1); }
}

const parts = MODES.map(mode => { const p = readPart(mode); if (!fresh(p, mode)) throw new Error(`${mode}: part missing or not current`); return p!; });
const merged = { ...parts[0]!, modes: Object.assign({}, ...parts.map(p => p.modes)), runtimeSeconds: Number(parts.reduce((a, p) => a + (p.runtimeSeconds as number), 0).toFixed(1)), generatedAt: new Date().toISOString() };
writeFileSync(resolve(dir, "rtp.json"), JSON.stringify(merged, null, 2) + "\n");
console.log(`merged ${MODES.join(", ")} into ${resolve(dir, "rtp.json")} (engine sha ${sha})`);
