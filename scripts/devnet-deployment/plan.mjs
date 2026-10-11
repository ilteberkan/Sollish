// Read-only funding inspection. No transaction construction, signing or sending.
import { readFile, readdir, lstat, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { LOADER_BYTES, calculateRentPlan } from '../../experiments/per/deployment-plan.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const RPC_URL = 'https://api.devnet.solana.com';
export const PAYER = '2By6MdhFoXhCxdhQMPt15PLPJo8Q3Ge3pw1QAJ2J4waA';
export const PROGRAMS = Object.freeze([
  { name: 'house', id: '9bHnYHRGiNP8umiqtpAsALJYgcAJu3dKWVE1voGfqAu2', keyPath: '.tooling/keys/house-keypair.json' },
  { name: 'incentives', id: 'E5tr12oarJumShYmXvohnSDJNVKrVGuKS4gLm6pdgfHv', keyPath: 'target/deploy/incentives-keypair.json' },
  { name: 'games', id: '8V4v7SqwVqx6aZUf2kFwJWdbSKBhqn5vdR4YeqZsfcQJ', keyPath: '.tooling/keys/games-keypair.json' },
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const amount = value => { if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_LAMPORT_AMOUNT'); return value; };
const sum = values => values.reduce((total, value) => amount(total + amount(value)), 0);
const allowedMethods = new Set(['getGenesisHash', 'getBalance', 'getMultipleAccounts', 'getMinimumBalanceForRentExemption']);

export function selectPrograms(selection = 'all') {
  const names = selection === 'all' ? PROGRAMS.map(p => p.name) : selection.split(',');
  if (new Set(names).size !== names.length || !['games,house', 'games,house,incentives'].includes([...names].sort().join(','))) throw new Error('INVALID_PROGRAM_SELECTION');
  // House is the custody boundary; if rewards are selected, deploy Incentives
  // before its Games CPI caller. Reward-free Games does not require Incentives.
  return PROGRAMS.filter(program => names.includes(program.name));
}
function selectedNames(programs) {
  if (!Array.isArray(programs) || programs.some(p => !p || typeof p.name !== 'string')) throw new Error('INVALID_PROGRAM_SELECTION');
  const names = programs.map(p => p.name).join(',');
  if (selectPrograms(names).map(p => p.name).join(',') !== names) throw new Error('INVALID_DEPLOYMENT_ORDER');
}

export function createReadonlyRpc({ fetchImpl = fetch, wait = ms => new Promise(r => setTimeout(r, ms)), now = () => performance.now() } = {}) {
  let previous = -Infinity, serial = Promise.resolve(), id = 0;
  return (method, params = []) => {
    if (!allowedMethods.has(method)) return Promise.reject(new Error('RPC_METHOD_NOT_READ_ONLY'));
    const run = serial.then(async () => {
      const delay = Math.max(0, previous + 600 - now()); if (delay) await wait(delay);
      previous = now(); const requestId = ++id;
      const response = await fetchImpl(RPC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), signal: AbortSignal.timeout(20_000) });
      if (response.status !== 200) throw new Error(`RPC_HTTP_${response.status}`);
      const reader = response.body?.getReader(); if (!reader) throw new Error('RPC_BODY_MISSING');
      const chunks = []; let length = 0;
      try { for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 65_536) { await reader.cancel(); throw new Error('RPC_BODY_TOO_LARGE'); } chunks.push(value); } } finally { reader.releaseLock(); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('RPC_JSON_INVALID'); }
      if (!body || body.jsonrpc !== '2.0' || body.id !== requestId || Object.hasOwn(body, 'error') || !Object.hasOwn(body, 'result')) throw new Error('RPC_ENVELOPE_INVALID');
      return body.result;
    });
    serial = run.catch(() => undefined); return run;
  };
}

export function validateLimits(limits) {
  if (!limits || Object.keys(limits).sort().join(',') !== 'maxFeePerTransactionLamports,maxTotalFeesLamports,payerReserveLamports') throw new Error('LIMITS_REQUIRED');
  for (const value of Object.values(limits)) amount(value);
  if (!limits.maxFeePerTransactionLamports || limits.maxTotalFeesLamports < limits.maxFeePerTransactionLamports) throw new Error('INVALID_FEE_CAP');
  return { ...limits };
}

export function validateArtifact({ program, binary, source, idl, manifestHash, keyPublic }) {
  // Pinned build-contracts.sh uses SBPFv2; solana-sbpf's EM_SBPF=263.
  if (!binary || binary.length < 64 || !binary.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) || binary[4] !== 2 || binary[5] !== 1 || binary.readUInt16LE(18) !== 263 || binary.readUInt32LE(48) !== 2) throw new Error('INVALID_SBF_ELF');
  if (hash(binary) !== manifestHash) throw new Error('ARTIFACT_MANIFEST_MISMATCH');
  if (/declare_id!\("([^"]+)"\)/.exec(source)?.[1] !== program.id || idl?.address !== program.id || keyPublic !== program.id) throw new Error('PROGRAM_ID_MISMATCH');
  return { name: program.name, programId: program.id, programKeyPath: program.keyPath, binaryPath: `target/deploy/${program.name}.so`, binaryBytes: binary.length, binarySha256: hash(binary), sourceSha256: hash(source), idlSha256: hash(JSON.stringify(idl)), maxLenBytes: binary.length, keypairMatches: true };
}

export function calculateFunding(programs, payerBalance, limits) {
  validateLimits(limits); amount(payerBalance);
  selectedNames(programs);
  const rows = programs.map(program => ({ name: program.name, ...calculateRentPlan(program.rents, payerBalance) }));
  const permanent = sum(rows.map(row => row.permanentRentLamports));
  const buffers = rows.map(row => row.intermediateBufferRentLamports);
  const extra = sum([limits.maxTotalFeesLamports, limits.payerReserveLamports]);
  const sequential = sum([permanent, Math.max(...buffers), extra]);
  const allBuffers = sum([permanent, sum(buffers), extra]);
  let priorPermanent = 0;
  const cliStages = programs.map(program => {
    const rents = program.rents;
    // Agave4.1.2 funds a new deploy buffer to ProgramData rent. Its loader
    // drains that deposit to payer BEFORE allocating ProgramData, atomically.
    const peak = sum([priorPermanent, rents.programData, rents.program]);
    const row = { name: program.name, priorPermanentRentLamports: priorPermanent, cliInitialBufferDepositLamports: rents.programData, finalProgramAccountRentLamports: rents.program, rentPeakBeforeBufferReuseLamports: peak };
    priorPermanent = sum([priorPermanent, rents.programData, rents.program]);
    return row;
  });
  const cliPeak = Math.max(...cliStages.map(row => row.rentPeakBeforeBufferReuseLamports));
  const cliWithLimits = sum([cliPeak, extra]);
  return {
    payerBalanceLamports: payerBalance, permanentRentLamports: permanent,
    permanentRentOnlyShortfallLamports: Math.max(0, permanent - payerBalance),
    largestTemporaryBufferRentLamports: Math.max(...buffers), allTemporaryBuffersRentLamports: sum(buffers),
    sequentialConservativeEnvelopeLamports: sequential, sequentialShortfallLamports: Math.max(0, sequential - payerBalance),
    allBuffersConservativeEnvelopeLamports: allBuffers, allBuffersShortfallLamports: Math.max(0, allBuffers - payerBalance),
    cliSequentialRentPeakLamports: cliPeak, cliSequentialEnvelopeWithLimitsLamports: cliWithLimits, cliSequentialShortfallLamports: Math.max(0, cliWithLimits - payerBalance), cliStages,
    meaning: 'Exact-size upgradeable-v3 Program+ProgramData rent. Agave4.1.2 fresh sequential deployment recycles each ProgramData-sized buffer deposit inside final deployment, so the rent peak equals final permanent rent. CLI envelope adds configured total fee ceiling and payer reserve. Older conservative envelopes additionally reserve minimum buffer rents as deliberate excess headroom; they are NOT CLI-required extra rent.',
    assumptions: ['All selected programs are absent; new deployment, not upgrade.', 'One new buffer per selected program; finish each deployment before starting another. No stranded/duplicate buffers.', 'maxLen equals exact ELF length, payer funds buffer and Program account, loader refunds buffer to that same payer.', 'Rent unchanged since snapshot; successful deployment; fee cap is a proposed ceiling, not a live fee quote or authorization.'],
    excluded: ['house bankroll', 'configuration and player account rent', 'VRF/provider fees', 'token mint or reward funding', 'future upgrades'],
  };
}

export async function inspectNetwork(programs, limits, call) {
  selectedNames(programs);
  if (await call('getGenesisHash') !== GENESIS) throw new Error('NON_DEVNET_GENESIS');
  const balance = await call('getBalance', [PAYER, { commitment: 'finalized' }]);
  amount(balance?.value); amount(balance?.context?.slot);
  const accounts = await call('getMultipleAccounts', [programs.map(p => p.programId), { commitment: 'finalized', minContextSlot: balance.context.slot, encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]);
  if (!accounts?.context || !Number.isSafeInteger(accounts.context.slot) || accounts.context.slot < balance.context.slot || !Array.isArray(accounts.value) || accounts.value.length !== programs.length) throw new Error('INVALID_PROGRAM_ACCOUNT_SNAPSHOT');
  if (accounts.value.some(value => value !== null)) throw new Error('PROGRAM_ALREADY_EXISTS_NEW_DEPLOYMENT_BLOCKED');
  const cache = new Map();
  const rent = async bytes => { if (!cache.has(bytes)) cache.set(bytes, amount(await call('getMinimumBalanceForRentExemption', [bytes, { commitment: 'finalized' }]))); return cache.get(bytes); };
  const rows = [];
  for (const program of programs) {
    const sizes = { program: LOADER_BYTES.program, buffer: LOADER_BYTES.buffer + program.maxLenBytes, programData: LOADER_BYTES.programData + program.maxLenBytes };
    const rents = {}; for (const [key, bytes] of Object.entries(sizes)) rents[key] = await rent(bytes);
    rows.push({ ...program, accountAbsentAtSlot: accounts.context.slot, rentAccountBytes: sizes, rents });
  }
  return { genesis: GENESIS, payer: PAYER, payerBalanceSlot: balance.context.slot, programAccountSlot: accounts.context.slot, programs: rows, limits: validateLimits(limits), funding: calculateFunding(rows, balance.value, limits) };
}

async function keyPublic(path) {
  const info = await lstat(resolve(ROOT, path));
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o600) throw new Error('KEY_FILE_MUST_BE_REGULAR_0600');
  return execFileSync(resolve(ROOT, '.tooling/bin/solana-keygen'), ['pubkey', resolve(ROOT, path)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 }).trim();
}

async function inputSnapshot() {
  const paths = ['Cargo.lock', 'Cargo.toml', 'Anchor.toml', 'rust-toolchain.toml'];
  async function walk(path) { for (const item of await readdir(resolve(ROOT, path), { withFileTypes: true })) { const child = `${path}/${item.name}`; if (item.isDirectory() && !['target', 'node_modules'].includes(item.name)) await walk(child); else if (item.isFile() && (item.name.endsWith('.rs') || item.name === 'Cargo.toml')) paths.push(child); } }
  for (const dir of ['programs', 'crates/game-math', 'crates/reward-math']) await walk(dir);
  return Promise.all(paths.sort().map(async path => ({ path, sha256: hash(await readFile(resolve(ROOT, path))) })));
}

export function sealPlan(plan) { const contents = JSON.stringify(plan, null, 2) + '\n'; return { contents, planSha256: hash(contents) }; }
export async function saveImmutablePlan(path, plan) {
  const sealed = sealPlan(plan); await writeFile(path, sealed.contents, { mode: 0o600, flag: 'wx' }); return sealed.planSha256;
}

export function parseArgs(args) {
  const names = { '--max-fee-per-transaction-lamports': 'maxFeePerTransactionLamports', '--max-total-fees-lamports': 'maxTotalFeesLamports', '--payer-reserve-lamports': 'payerReserveLamports' };
  const limits = {}; let selection;
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--programs') { if (selection !== undefined || args[i + 1] === undefined) throw new Error('INVALID_PROGRAM_SELECTION'); selection = args[i + 1]; continue; }
    const field = names[args[i]], value = args[i + 1]; if (!field || Object.hasOwn(limits, field) || !/^(0|[1-9][0-9]*)$/.test(value ?? '')) throw new Error('EXPLICIT_NUMERIC_PLANNING_LIMITS_REQUIRED'); limits[field] = Number(value);
  }
  return { limits: validateLimits(limits), selected: selectPrograms(selection ?? 'all') };
}

async function main() {
  const { limits, selected } = parseArgs(process.argv.slice(2));
  if (await keyPublic('.tooling/per/probe-payer-keypair.json') !== PAYER) throw new Error('PAYER_KEY_MISMATCH');
  const manifest = await readFile(resolve(ROOT, 'target/deploy/artifacts.sha256'), 'utf8');
  const anchor = await readFile(resolve(ROOT, 'Anchor.toml'), 'utf8');
  const programs = [];
  for (const program of selected) {
    if (!anchor.includes(`${program.name} = "${program.id}"`)) throw new Error('ANCHOR_PROGRAM_ID_MISMATCH');
    const binary = await readFile(resolve(ROOT, `target/deploy/${program.name}.so`));
    const source = await readFile(resolve(ROOT, `programs/${program.name}/src/lib.rs`), 'utf8');
    const idlBytes = await readFile(resolve(ROOT, `target/idl/${program.name}.json`));
    const matches = manifest.split('\n').filter(line => line.endsWith(`  target/deploy/${program.name}.so`));
    if (matches.length !== 1) throw new Error('ARTIFACT_MANIFEST_ENTRY_MISSING');
    const row = validateArtifact({ program, binary, source, idl: JSON.parse(idlBytes), manifestHash: matches[0].split(' ')[0], keyPublic: await keyPublic(program.keyPath) });
    row.idlSha256 = hash(idlBytes); // Preserve exact file bytes, not JSON normalization.
    const generated = `target/deploy/${program.name}-keypair.json`;
    row.autoGeneratedTargetKeyMatches = await keyPublic(generated) === program.id;
    programs.push(row);
  }
  const localInputs = await inputSnapshot();
  const inspected = await inspectNetwork(programs, limits, createReadonlyRpc());
  const plan = { schemaVersion: 2, createdAt: new Date().toISOString(), status: 'BLOCKED', productionApproved: false, sendsTransactions: false, selection: selected.map(p => p.name), rewardFundingIncluded: false, rpcUrl: RPC_URL, loader: 'upgradeable-v3', maxLenPolicy: 'Exact ELF length; other allocation policies require a new plan.', ...inspected, localInputs,
    gates: ['Planning only; fee caps are proposed limits, never a spending authorization.', 'Every deployment must recheck this plan hash, fresh genesis/balance/rent, exact maxLen and artifact/key identity before writing.', 'Current hashes bind observed artifacts and source inputs; this planner does not perform a fresh reproducible SBF build or establish compiler/source equivalence.', 'No deployment, game configuration, real oracle roundtrip, independent audit or mainnet readiness is proved.'],
    sourceReferences: { cli: 'https://github.com/anza-xyz/agave/blob/v4.1.2/cli/src/program.rs#L1371-L1385', bufferFunding: 'https://github.com/anza-xyz/agave/blob/v4.1.2/cli/src/program.rs#L2453-L2467', loaderReuse: 'https://github.com/anza-xyz/agave/blob/v4.1.2/programs/bpf_loader/src/lib.rs#L259-L273' },
    targetKeyWarning: 'Autogenerated target/deploy House/Games keys differ from declare_id. Use only the explicitly matched programKeyPath; do not use default anchor deploy.',
  };
  const folder = resolve(ROOT, '.tooling/contracts-deployment'); await mkdir(folder, { recursive: true, mode: 0o700 });
  const path = resolve(folder, `plan-${plan.createdAt.replaceAll(':', '-').replaceAll('.', '-')}.json`);
  const planSha256 = await saveImmutablePlan(path, plan);
  console.log(JSON.stringify({ path, planSha256, status: plan.status, payer: plan.payer, programs: plan.programs.map(p => ({ name: p.name, programId: p.programId, binaryBytes: p.binaryBytes, rents: p.rents, autoGeneratedTargetKeyMatches: p.autoGeneratedTargetKeyMatches })), funding: plan.funding }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { const code = typeof error?.message === 'string' && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PLANNING_FAILED'; console.error(JSON.stringify({ status: 'BLOCKED', error: code })); process.exitCode = 1; }
}
