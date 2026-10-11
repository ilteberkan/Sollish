// Builds the hash-pinned "Jev kaydı" table (apps/web/lib/jev-style-cache.json) from real TypeSafe answers
// recorded in this folder's evidence: per-call JSONL rows (obsHash + style + confidence) and decision logs
// of real-scene bouts (source "jev" decisions). First recorded answer per obsHash wins. Rewrites the pin in
// apps/web/lib/jev-style-cache.ts. Usage: bash scripts/use-node.sh apps/web/node_modules/.bin/tsx experiments/decision-agent/build-style-cache.ts
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalJson, isFightStyle, sha256Utf8Hex } from '../../packages/protocol/src/fight-style';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const entries: Record<string, { style: string; confidence: number }> = {}, sources: { file: string; sha256: string; answers: number }[] = [];
let duplicates = 0, disagreements = 0;
const add = (hash: unknown, style: unknown, confidence: unknown) => {
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || !isFightStyle(style) || typeof confidence !== 'number') return 0;
  if (entries[hash]) { duplicates++; if (entries[hash]!.style !== style) disagreements++; return 0; }
  entries[hash] = { style, confidence }; return 1;
};
const files = ['evidence/style-real-calls.jsonl', ...readdirSync(here('evidence')).filter(f => /^style-bout-.*\.json$/.test(f)).sort().map(f => `evidence/${f}`)];
for (const file of files) {
  if (!existsSync(here(file))) continue;
  const text = readFileSync(here(file), 'utf8'); let answers = 0;
  if (file.endsWith('.jsonl')) for (const line of text.split('\n').filter(Boolean)) { const r = JSON.parse(line); if (r.code === 'OK' && r.providerCall !== false) answers += add(r.obsHash, r.style, r.confidence); }
  else for (const d of (JSON.parse(text).log?.decisions ?? [])) if (d.source === 'jev') answers += add(d.obsHash, d.style, d.confidence);
  sources.push({ file: `experiments/decision-agent/${file}`, sha256: createHash('sha256').update(text).digest('hex'), answers });
}
const table = { version: 'jev-style-cache-1', model: 'jev-1.13.0', note: 'Recorded TypeSafe Jev answers keyed by observation digest (obsHash). Shown as önbellek, never as a live answer.', sources, entries };
const pin = sha256Utf8Hex(canonicalJson(table));
writeFileSync(here('../../apps/web/lib/jev-style-cache.json'), JSON.stringify(table) + '\n');
const loader = here('../../apps/web/lib/jev-style-cache.ts');
writeFileSync(loader, readFileSync(loader, 'utf8').replace(/JEV_STYLE_CACHE_SHA256 = '[0-9a-f]{64}'/, `JEV_STYLE_CACHE_SHA256 = '${pin}'`));
console.log(JSON.stringify({ entries: Object.keys(entries).length, duplicates, disagreements, sources: sources.map(s => [s.file, s.answers]), pin }));
