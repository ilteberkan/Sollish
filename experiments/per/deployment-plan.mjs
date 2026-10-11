// Read-only rent/funding inspection for our own test program. Never signs/sends.
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ROOT, rpc, redact, saveReport, sha256 } from './lib.mjs';

const DEVNET = 'https://api.devnet.solana.com';
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
// Pinned solana-loader-v3-interface state layout: Program, Buffer, ProgramData.
export const LOADER_BYTES = Object.freeze({ program: 36, buffer: 37, programData: 45 });

export function validateBuild(report, artifacts, programId) {
  if (!programId || report?.programId !== programId || report.localArtifactConsistency !== 'PASS') throw new Error('Unverified own program identity');
  for (const [field, bytes] of Object.entries(artifacts)) {
    if (!Buffer.isBuffer(bytes) || sha256(bytes) !== report[field]) throw new Error(`Local artifact changed: ${field}; rebuild the probe`);
  }
  for (const field of ['sourceSha256', 'binarySha256', 'idlSha256', 'cargoLockSha256']) {
    if (!Object.hasOwn(artifacts, field)) throw new Error(`Missing local artifact: ${field}`);
  }
  const binary = artifacts.binarySha256;
  if (binary.length !== report.binaryBytes || !binary.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new Error('Invalid program ELF');
  const sourceId = /declare_id!\("([^"]+)"\)/.exec(artifacts.sourceSha256.toString())?.[1];
  if (sourceId !== programId || JSON.parse(artifacts.idlSha256).address !== programId) throw new Error('Source and IDL identity differ');
  return binary.length;
}

export function calculateRentPlan(rents, payerBalance) {
  for (const value of [...Object.values(rents), payerBalance]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid lamport amount');
  }
  if (!['program', 'buffer', 'programData'].every(name => Object.hasOwn(rents, name))) throw new Error('Missing rent component');
  const permanent = rents.program + rents.programData;
  const conservativePeak = permanent + rents.buffer;
  if (!Number.isSafeInteger(conservativePeak)) throw new Error('Lamport sum overflow');
  return {
    permanentRentLamports: permanent,
    intermediateBufferRentLamports: rents.buffer,
    conservativeRentEnvelopeLamports: conservativePeak,
    payerBalanceLamports: payerBalance,
    rentEnvelopeShortfallLamports: Math.max(0, conservativePeak - payerBalance),
    feesAndExperimentFundingIncluded: false,
    meaning: 'Sum of program, exact-size ProgramData, and temporary buffer rent. Conservative envelope, not the minimum CLI balance: loader may recycle buffer lamports. Transaction fees and player/permission funding are additional; this is not a spending authorization.'
  };
}

async function main() {
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), scope: 'Read-only own-probe rent and funding inspection; no transaction, faucet, key creation or deployment', status: 'BLOCKED', checks: [] };
  try {
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT)));
    const build = JSON.parse(await readFile(new URL('program/artifacts/own-probe-build.json', ROOT)));
    const paths = { sourceSha256: 'program/src/lib.rs', binarySha256: 'program/target/deploy/per_probe.so', idlSha256: 'program/artifacts/per_probe.idl.json', cargoLockSha256: 'program/Cargo.lock' };
    const artifacts = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await readFile(new URL(path, ROOT))])));
    const length = validateBuild(build, artifacts, manifest.ownProbeBuild?.programId);
    report.programId = build.programId;
    report.binaryBytes = length;
    report.binarySha256 = build.binarySha256;
    report.maxLenBytes = length;
    report.checks.push({ id: 'local-artifacts', status: 'PASS' });

    const keygen = fileURLToPath(new URL('../../.tooling/bin/solana-keygen', ROOT));
    const ownPublicKey = name => execFileSync(keygen, ['pubkey', fileURLToPath(new URL(`../../.tooling/per/${name}-keypair.json`, ROOT))], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (ownPublicKey('probe-program') !== report.programId) throw new Error('Owned program key does not match build');
    report.payer = ownPublicKey('probe-payer');
    if (report.payer === report.programId) throw new Error('Program and fee payer must be separate');
    const genesis = await rpc(DEVNET, 'getGenesisHash');
    if (genesis !== GENESIS || manifest.devnetGenesisHash !== GENESIS) throw new Error('Refusing non-devnet endpoint');
    report.checks.push({ id: 'devnet-genesis', status: 'PASS', evidence: genesis });
    const sizes = { program: LOADER_BYTES.program, buffer: LOADER_BYTES.buffer + length, programData: LOADER_BYTES.programData + length };
    const rentResults = await Promise.all(Object.entries(sizes).map(async ([name, bytes]) => [name, await rpc(DEVNET, 'getMinimumBalanceForRentExemption', [bytes, { commitment: 'confirmed' }])]));
    report.rentAccounts = Object.fromEntries(rentResults.map(([name, lamports]) => [name, { dataBytes: sizes[name], lamports }]));
    const balance = await rpc(DEVNET, 'getBalance', [report.payer, { commitment: 'confirmed' }]);
    report.observedSlot = balance.context?.slot;
    report.funding = calculateRentPlan(Object.fromEntries(rentResults), balance.value);
    report.checks.push({ id: 'rent-envelope', status: report.funding.rentEnvelopeShortfallLamports === 0 ? 'PASS' : 'BLOCKED', evidence: report.funding });
    report.checks.push({ id: 'deployment-readiness', status: 'BLOCKED', evidence: 'Fees, experimental account funding, live deployment verification and TEE acceptance are separate. This report never approves deployment or production.' });
  } catch (e) {
    report.checks.push({ id: 'inspection', status: 'BLOCKED', evidence: redact(e.message) });
  }
  report.finishedAt = new Date().toISOString();
  await saveReport('deployment-plan-latest', report);
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
