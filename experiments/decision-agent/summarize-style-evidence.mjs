// Summarizes evidence/style-real-calls.jsonl (one line per real TypeSafe call; counts only, never bodies or keys)
// into evidence/style-benchmark.json. Usage: node experiments/decision-agent/summarize-style-evidence.mjs
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const here = new URL('./', import.meta.url), read = p => readFileSync(new URL(p, here));
const sha = p => createHash('sha256').update(read(p)).digest('hex');
const rows = read('evidence/style-real-calls.jsonl').toString().split('\n').filter(Boolean).map(l => JSON.parse(l));
const calls = rows.filter(r => !r.calls && r.providerCall !== false), viaRoute = rows.filter(r => r.calls), rejectedBeforeProvider = rows.filter(r => r.providerCall === false).length;
const q = (xs, p) => { const v = [...xs].sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : null; };
const stats = xs => ({ n: xs.length, min: Math.min(...xs), p50: q(xs, .5), p90: q(xs, .9), max: Math.max(...xs), mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) });
const count = xs => xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});
const ok = calls.filter(r => r.code === 'OK');
const summary = {
  observedAt: new Date().toISOString(), scope: 'real authenticated TypeSafe calls from this Mac (Node 24 production server client, sequential); not hosted, not a load test',
  model: 'jev-1.13.0', endpoint: 'https://api.typesafe.ai/v1/systemone',
  realCallsTotal: calls.length + viaRoute.reduce((n, r) => n + r.calls, 0), directCalls: calls.length, rejectedBeforeProvider, routeCallBatches: viaRoute,
  codes: count(calls.map(r => r.code)), byPoint: count(calls.map(r => r.point)), byPath: count(calls.map(r => r.via)),
  // Per path: node-production-client = askJevStyle from Node (provider latency incl. TLS + bounded body read);
  // next-route-node = POST through the local `next dev` route (adds Next routing + JSON on top).
  paths: Object.fromEntries([...new Set(calls.map(r => r.via))].map(via => { const xs = ok.filter(r => r.via === via), tok = xs.filter(r => typeof r.inputTokens === 'number');
    return [via, { ok: xs.length, latencyMs: xs.length ? stats(xs.map(r => r.elapsedMs)) : null, inputTokens: tok.length ? stats(tok.map(r => r.inputTokens)) : null, outputTokens: tok.length ? stats(tok.map(r => r.outputTokens)) : null }]; })),
  styles: count(ok.map(r => r.style)), confidence: ok.length ? stats(ok.map(r => r.confidence)) : null,
  agreementWithFallbackRule: (xs => xs.length ? { n: xs.length, share: +(xs.filter(r => r.style === r.fallback).length / xs.length).toFixed(3) } : null)(ok.filter(r => r.fallback)),
  observations: 'decision points of real Combat Club bouts (seeds 6101-6106, both corners neuro-2 Jev strategist on the fallback path; neuro-2 model as recorded in each run) via createStyleSession; integer-only public observation, no seed/tick/ids',
  limits: ['Latency includes TLS and the 16 KiB bounded body read; elapsed is wall clock on one Mac over one network.', 'Decision quality is not evaluated; agreement with the authored fallback rule is descriptive only.', 'Small sample; no concurrency; provider-side variance unmeasured.'],
  files: ['style-benchmark.ts', 'style-route-check.mjs', 'build-style-cache.ts', 'summarize-style-evidence.mjs', 'evidence/style-real-calls.jsonl', ...readdirSync(new URL('evidence/', here)).filter(f => /^style-bout-.*\.json$/.test(f)).map(f => 'evidence/' + f), '../../apps/web/lib/server/typesafe-style.ts', '../../apps/web/app/api/ringside/style/route.ts'].map(file => ({ file, sha256: sha(file) })),
};
writeFileSync(new URL('evidence/style-benchmark.json', here), JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify({ realCallsTotal: summary.realCallsTotal, codes: summary.codes, paths: summary.paths, styles: summary.styles, agreement: summary.agreementWithFallbackRule }));
