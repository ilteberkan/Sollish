// Freezes a trained checkpoint into packages/protocol/src/contact-v5-weights.ts (new engine id).
// Usage: node --import tsx experiments/ringside-learner/freeze.ts --run <dir> --rule v5k --evidence <dir>
//        node --import tsx experiments/ringside-learner/freeze.ts --placeholder   (untrained all-zero checkpoint)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { arg } from './common';
import { writeWeights } from './weights';
import { zeroLearnerParams } from '../../packages/protocol/src/contact-learner';

// --file <path> writes somewhere else than packages/protocol/src/contact-v5-weights.ts (dry runs).
const file = process.argv.includes('--file') ? arg('file', '') : undefined;
if (process.argv.includes('--placeholder')) {
  // Untrained all-zero checkpoint for the current action/input shapes (keeps the engine runnable before training).
  const sha = writeWeights(zeroLearnerParams(), { placeholder: 'all-zero readout, untrained', rule: arg('rule', 'v5k') }, file, false);
  console.log('engine', `ringside-contact-5-${sha.slice(0, 8)}`, 'placeholder');
  process.exit(0);
}
const run = arg('run', ''), raw = readFileSync(`${run}/params.json`, 'utf8'), log = JSON.parse(readFileSync(`${run}/train-log.json`, 'utf8'));
const sha = writeWeights(JSON.parse(raw), { run, paramsSha256: createHash('sha256').update(raw).digest('hex'), lifetimeRounds: log.matches, seeds: log.seeds, lifetimeRates: log.rates, rule: arg('rule', 'v4'), evidence: arg('evidence', '') }, file);
console.log('engine', `ringside-contact-5-${sha.slice(0, 8)}`);
