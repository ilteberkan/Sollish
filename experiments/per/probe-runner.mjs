import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { saveReport, sha256 } from './lib.mjs';
import { inspectOwnVrfVisibility } from './vrf-visibility.mjs';
import {
  PIN, KEY_DIR, ProbeWriteJournal, authenticate, capture, classifyIsolation, containsSecret, decodeReceipt, decodeRound,
  inspectDeployment, instructionSummary, isCanonicalTransactionSignature, loadArtifacts, loadKeys, makePlan, observationSummary,
  probeInstruction, reconcileInitializedContinuation, requireWriteOptIn, rpc, sendOwnInstruction, signedTransaction, simulationInstruction, simulationParams, validatePlan,
} from './probe-client.mjs';

const PLAN = new URL('probe-plan.json', KEY_DIR);

function errorDigest(value) {
  let text;
  try { text = typeof value === 'string' ? value : JSON.stringify(value); }
  catch { text = 'UNSERIALIZABLE_ERROR'; }
  return sha256(typeof text === 'string' ? text : 'MISSING_ERROR');
}

// Redacting credentials is insufficient: a provider error may contain private
// account data or VRF proof bytes. Only fixed labels and one-way digests persist.
export function safeFailure(error) {
  const message = error instanceof Error ? error.message : error;
  let classification = 'EXPERIMENT_ERROR';
  if (typeof message === 'string') {
    if (message === 'Own probe is not deployed') classification = 'OWN_PROGRAM_NOT_DEPLOYED';
    else if (/^Own (inspector|playerA|playerB) wallet is unfunded; no automatic faucet\/transfer$/.test(message)) classification = 'OWN_WALLET_UNFUNDED';
    else if (/^HTTP (401|403)(?:$|:)/.test(message)) classification = 'AUTHORIZATION_ERROR';
    else if (/^HTTP \d{3}(?:$|:)/.test(message)) classification = 'HTTP_ERROR';
    else if (/^RPC /.test(message)) classification = 'RPC_ERROR';
    else if (/^Own [a-z_]+ transaction failed:/.test(message)) classification = 'TRANSACTION_ERROR';
    else if (/^Confirmation unresolved for own /.test(message)) classification = 'CONFIRMATION_UNRESOLVED';
    else if (/^Own round state timeout:/.test(message)) classification = 'ROUND_STATE_TIMEOUT';
  }
  return { classification, errorSha256: errorDigest(message), rawErrorPersisted: false };
}

export function summarizeSimulation(observation) {
  const body = observation?.body;
  const summary = (classification, error = undefined, succeeded = false) => ({ simulationSucceeded: succeeded, simulationError: { classification, errorSha256: error === undefined ? null : errorDigest(error), rawErrorPersisted: false } });
  if (observation?.httpStatus !== 200) return summary('TRANSPORT_OR_HTTP_ERROR', observation?.text);
  if (!body || body.jsonrpc !== '2.0' || body.id !== 1) return summary('INVALID_RPC_ENVELOPE');
  if (Object.hasOwn(body, 'error')) return summary('RPC_ERROR', body.error);
  const value = body.result?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'err') || value.err === undefined) return summary('NOT_OBSERVED');
  if (value.err === null) return summary('NONE', undefined, true);
  const err = value.err;
  const instructionError = err && typeof err === 'object' && !Array.isArray(err) && Array.isArray(err.InstructionError) && err.InstructionError.length === 2 && Number.isSafeInteger(err.InstructionError[0]) && err.InstructionError[0] >= 0;
  const validType = typeof err === 'string' || err && typeof err === 'object' && !Array.isArray(err);
  return summary(instructionError ? 'INSTRUCTION_ERROR' : validType ? 'TRANSACTION_ERROR' : 'MALFORMED_EXECUTION_ERROR', err);
}

export function selectOwnHistory(history) {
  const selection = { signatures: [], malformedCount: 0, duplicateCount: 0, truncated: false, missing: !Array.isArray(history) };
  if (selection.missing) return selection;
  selection.truncated = history.length > 30;
  for (const entry of history.slice(0, 30)) {
    if (!isCanonicalTransactionSignature(entry?.signature)) { selection.malformedCount++; continue; }
    if (selection.signatures.includes(entry.signature)) { selection.duplicateCount++; continue; }
    selection.signatures.push(entry.signature);
  }
  return selection;
}

export function parseArguments(args) {
  const [mode = 'prepare', ...flags] = args;
  if (!['prepare', 'inspect', 'run', 'resume-initialized'].includes(mode)) throw new Error('Use prepare, inspect, run or explicit resume-initialized; deployment is separate');
  const options = { mode, experimentalDevnet: false, allowWrites: false, roundId: null };
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--experimental-devnet') options.experimentalDevnet = true;
    else if (flags[i] === '--allow-writes') options.allowWrites = true;
    else if (flags[i] === '--round-id' && /^\d+$/.test(flags[i + 1] ?? '')) options.roundId = flags[++i];
    else throw new Error(`Unsupported argument ${flags[i]}`);
  }
  const writes = ['run', 'resume-initialized'].includes(mode);
  if (!writes && (options.experimentalDevnet || options.allowWrites)) throw new Error('Write flags only apply to run or resume-initialized');
  if (mode !== 'prepare' && options.roundId !== null) throw new Error('Round ID is chosen only during offline prepare');
  if (writes) requireWriteOptIn(options);
  return options;
}

export function offlineSequence(idl, plan) {
  const operations = [
    ['L1', 'initialize_round', null], ['L1', 'initialize_receipt', 0], ['L1', 'initialize_receipt', 1],
    ['L1', 'delegate_receipt', 0], ['L1', 'delegate_receipt', 1], ['L1', 'delegate_round', null],
    ['TEE', 'prepare_private', null], ['TEE', 'request_probe_randomness', null],
    ['TEE', 'submit_probe', 0], ['TEE', 'submit_probe', 1], ['TEE', 'reveal_probe', null],
  ];
  return operations.map(([chain, name, index]) => ({ chain, role: index === null ? 'inspector' : ['playerA', 'playerB'][index], ...instructionSummary(idl, probeInstruction(idl, plan, name, { playerIndex: index ?? 0 }), name) }));
}

async function ownAccount(url, address) {
  return (await rpc(url, 'getAccountInfo', [address, { encoding: 'base64', commitment: 'confirmed' }])).value;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitRound(url, idl, plan, expected) {
  let last = 'Account not observed';
  for (let i = 0; i < 20; i++) {
    try {
      const account = await ownAccount(url, plan.round), state = decodeRound(account, idl, plan);
      if (state.status === expected) return { account, state };
      if (state.status > expected) throw new Error('Unexpected later round state; refusing implicit replay');
      last = `Observed state ${state.status}, expected ${expected}`;
    } catch (e) { last = JSON.stringify(safeFailure(e)); }
    await sleep(1000);
  }
  throw new Error(`Own round state timeout: ${last}`);
}

// Matrix raw responses stay in memory only, until the explicit reveal comparison.
async function matrix({ artifacts, plan, keys, sessions, phase, rows, raw, checks }) {
  const roles = [['anonymous', PIN.tee], ...Object.entries(sessions).map(([role, s]) => [role, s.url])];
  const baseSnapshot = await capture(PIN.base, 'getAccountInfo', [plan.round, { encoding: 'base64', commitment: 'confirmed' }]);
  rows.push({ phase, role: 'base-public', method: 'getAccountInfo', account: 'round', ...observationSummary(baseSnapshot) });
  raw.push({ phase, role: 'base-public', method: 'getAccountInfo:round', body: baseSnapshot.body });
  const inspectorAccount = await ownAccount(sessions.inspector.url, plan.round);
  for (const [role, url] of roles) {
    for (const [label, address] of [['round', plan.round], ['receiptA', plan.receipts[0].address], ['receiptB', plan.receipts[1].address]]) {
      const observed = await capture(url, 'getAccountInfo', [address, { encoding: 'base64', commitment: 'confirmed' }]);
      rows.push({ phase, role, method: 'getAccountInfo', account: label, ...observationSummary(observed) });
      raw.push({ phase, role, method: `getAccountInfo:${label}`, body: observed.body });
      if (label === 'round' && role !== 'inspector') checks.push({ id: `${phase}-${role}-round-read-isolation`, status: classifyIsolation(inspectorAccount, observed, artifacts.idl, plan), evidence: observationSummary(observed) });
      if (label !== 'round') {
        let status = 'BLOCKED';
        try { decodeReceipt(observed.body?.result?.value, artifacts.idl, plan, label === 'receiptA' ? 0 : 1); status = 'PASS'; } catch { /* account absence/filtered output is not success */ }
        checks.push({ id: `${phase}-${role}-${label}-public-read`, status });
      }
    }
  }
  if (phase !== 'ready') return;
  const signatures = await capture(sessions.inspector.url, 'getSignaturesForAddress', [plan.round, { limit: 30, commitment: 'confirmed' }]);
  const history = signatures.body?.result;
  const selection = selectOwnHistory(history);
  const ownSignatures = selection.signatures;
  if (selection.truncated) checks.push({ id: 'own-history-bounded', status: 'BLOCKED', evidence: 'Provider returned more than requested limit30; only first30 own-round history entries considered' });
  if (selection.malformedCount > 0) checks.push({ id: 'own-history-invalid-signature', status: 'BLOCKED', evidence: { classification: 'MALFORMED_SIGNATURE_RECORDS', rejectedCount: selection.malformedCount, rawRecordsPersisted: false } });
  rows.push({ phase, role: 'inspector', method: 'getSignaturesForAddress', ...observationSummary(signatures) });
  if (ownSignatures.length === 0) checks.push({ id: 'own-request-callback-history', status: 'BLOCKED', evidence: 'No canonical own-round signature history; callback transaction privacy remains unobserved' });
  // These are only signatures returned for OUR round, never queue-wide/provider history.
  for (const [role, url] of roles) {
    const list = await capture(url, 'getSignaturesForAddress', [plan.round, { limit: 30, commitment: 'confirmed' }]);
    rows.push({ phase, role, method: 'getSignaturesForAddress', ...observationSummary(list) });
    raw.push({ phase, role, method: 'getSignaturesForAddress', body: list.body });
    for (const signature of ownSignatures) {
      for (const encoding of ['json', 'base64']) {
        const tx = await capture(url, 'getTransaction', [signature, { encoding, commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
        rows.push({ phase, role, method: 'getTransaction', encoding, signature, includesLogsAndInnerInstructions: !!tx.body?.result?.meta, ...observationSummary(tx) });
        raw.push({ phase, role, method: `getTransaction:${encoding}:message+logs+innerInstructions`, encoding, signature, body: tx.body });
      }
    }
    for (const [index, key] of [keys.playerA, keys.playerB].entries()) {
      // Player signs its own explicit instruction once; read-RPC auth role varies.
      let nonce;
      try {
        const receipt = decodeReceipt(await ownAccount(sessions.inspector.url, plan.receipts[index].address), artifacts.idl, plan, index);
        nonce = BigInt(receipt.lastNonce) + 1n;
      } catch (e) {
        checks.push({ id: `${role}-player${index}-simulation-prerequisite`, status: 'BLOCKED', evidence: safeFailure(e) });
        continue;
      }
      for (const variant of ['readonly', 'writable-promoted']) {
        const recent = (await rpc(sessions.inspector.url, 'getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
        const wire = signedTransaction(simulationInstruction(artifacts.idl, plan, index, nonce, variant), key, recent.blockhash);
        const simulated = await capture(url, 'simulateTransaction', simulationParams(wire, plan, index));
        rows.push({ phase, role, method: 'simulateTransaction', variant, signedPlayer: index, nonce: nonce.toString(), ...summarizeSimulation(simulated), requestedReturnAccounts: ['round', `receipt${index ? 'B' : 'A'}`], ...observationSummary(simulated) });
        raw.push({ phase, role, method: `simulateTransaction:${variant}:logs+returnData+accounts`, body: simulated.body });
      }
    }
  }
}

async function runExperiment(artifacts, plan, keys, options, report, journal) {
  const check = (id, status, evidence) => report.checks.push({ id, status, ...(evidence === undefined ? {} : { evidence }) });
  report.deployment = await inspectDeployment(artifacts, plan.inspector);
  if (options.mode === 'resume-initialized') {
    const proof = await reconcileInitializedContinuation({ artifacts, plan, journal });
    report.transactions.push(...proof.confirmed);
    check('same-round-finalized-initializers', 'PASS', proof);
  } else {
    for (const address of [plan.round, ...plan.receipts.map(r => r.address)]) {
      if (await ownAccount(PIN.base, address)) throw new Error('Own experiment address already exists; normal run is not resumable and never automatically rerolls');
    }
  }
  for (const [role, key] of Object.entries(keys)) {
    const balance = (await rpc(PIN.base, 'getBalance', [key.publicKey.toBase58(), { commitment: 'confirmed' }])).value;
    if (!Number.isSafeInteger(balance) || balance <= 0) throw new Error(`Own ${role} wallet is unfunded; no automatic faucet/transfer`);
  }
  // Authentication/copy compatibility must fail before non-resumable L1 init.
  const sessions = {};
  for (const [role, key] of Object.entries(keys)) {
    sessions[role] = await authenticate(key);
    report.sessions[role] = { publicKey: key.publicKey.toBase58(), expiresAt: sessions[role].expiresAt, expirySource: sessions[role].expirySource, jwtSignatureVerified: false, authorizationGrantedLocally: false, tokenPersisted: false };
  }
  await inspectDeployment(artifacts, plan.inspector, { teeUrl: sessions.inspector.url });
  const send = async (name, role, url, playerIndex = 0) => {
    if (url !== PIN.base && report.sessions[role].expiresAt <= Date.now() + 30000) throw new Error(`Own ${role} auth near expiry; no silent renewal`);
    const signature = await sendOwnInstruction({ artifacts, plan, name, key: keys[role], playerIndex, url, options, journal });
    report.transactions.push({ name, role, signature, chain: url === PIN.base ? 'L1' : 'TEE' });
    return signature;
  };
  // Existing key balances and deployment are prerequisites, not sourced by this runner.
  if (options.mode !== 'resume-initialized') {
    await send('initialize_round', 'inspector', PIN.base);
    await send('initialize_receipt', 'playerA', PIN.base, 0);
    await send('initialize_receipt', 'playerB', PIN.base, 1);
  }
  await send('delegate_receipt', 'playerA', PIN.base, 0);
  await send('delegate_receipt', 'playerB', PIN.base, 1);
  await send('delegate_round', 'inspector', PIN.base);
  await waitRound(sessions.inspector.url, artifacts.idl, plan, 0);
  await send('prepare_private', 'inspector', sessions.inspector.url);
  await waitRound(sessions.inspector.url, artifacts.idl, plan, 1);
  check('private-prepared-before-vrf', 'PASS', 'Own program confirmed prepare_private then inspector observed state PRIVATE_PREPARED; VRF request has not been sent yet');
  const raw = [];
  await matrix({ artifacts, plan, keys, sessions, phase: 'prepared', rows: report.rows, raw, checks: report.checks });
  await send('request_probe_randomness', 'inspector', sessions.inspector.url);
  await waitRound(sessions.inspector.url, artifacts.idl, plan, 3);
  check('own-scoped-callback-ready', 'PASS', 'Own account reached READY; binary only enters READY through scoped callback. Transaction/history exposure is a separate check.');
  for (const [index, role] of ['playerA', 'playerB'].entries()) {
    try {
      await send('submit_probe', role, sessions[role].url, index);
      const receipt = decodeReceipt(await ownAccount(sessions[role].url, plan.receipts[index].address), artifacts.idl, plan, index);
      check(`${role}-submit-with-readonly-private-round`, receipt.lastNonce === '1' && receipt.acceptedCount === '1' ? 'PASS' : 'FAIL', receipt);
    } catch (e) {
      check(`${role}-submit-with-readonly-private-round`, 'BLOCKED', safeFailure(e));
      // A denial must never be worked around by adding player ACL membership.
    }
  }
  await matrix({ artifacts, plan, keys, sessions, phase: 'ready', rows: report.rows, raw, checks: report.checks });
  await send('reveal_probe', 'inspector', sessions.inspector.url);
  const revealed = await waitRound(sessions.inspector.url, artifacts.idl, plan, 4);
  report.reveal = { randomnessSha256: sha256(revealed.state.randomness), publicRound: plan.round, rawRandomnessPersisted: false };
  for (const item of raw) {
    if (item.role === 'inspector') continue; // inspector is intentionally privileged, never operator-blind
    const leaked = containsSecret(item.body, revealed.state.randomness);
    report.leakSearch.push({ phase: item.phase, role: item.role, method: item.method, revealedRandomnessFound: leaked });
    if (item.method.startsWith('getTransaction:')) {
      const observation = inspectOwnVrfVisibility(item.body?.result, { round: plan.round, revealedRandomness: revealed.state.randomness, signature: item.signature });
      report.leakSearch.push({ phase: item.phase, role: item.role, method: item.method, kind: 'VRF_OUTPUT_DERIVATION', signature: item.signature, revealedRandomnessFound: observation.exposed, observation });
    }
  }
  check('captured-responses-secret-scan', report.leakSearch.some(x => x.revealedRandomnessFound) ? 'FAIL' : 'PASS', 'Only captured JSON strings, base64/base58 byte payloads and byte arrays; absence is not a complete confidentiality proof');
  const derived = report.leakSearch.filter(x => x.kind === 'VRF_OUTPUT_DERIVATION');
  check('vrf-output-derived-secret-scan', derived.some(x => x.revealedRandomnessFound) ? 'FAIL' : 'BLOCKED', {
    observations: derived.length, ownScopedCandidates: derived.reduce((sum, x) => sum + x.observation.candidates.length, 0),
    meaning: 'Pinned ProvideRandomness ABI, own program/queue/round/scoped identity, SHA256(output32) comparison only. The combined request input was not independently reconstructed; account scope is an inference. No proof verification, shared-queue or streaming coverage. No-match or unavailable data cannot establish G2.',
  });
  check('streaming-log-and-account-subscriptions', 'BLOCKED', 'HTTP transaction meta.logMessages were queried. WebSocket subscriptions and subscription-time filtering are not implemented here.');
  check('vrf-queue-inflight-own-request-visibility', 'BLOCKED', 'Own round callback/history only; shared queue contents were deliberately not collected or decoded.');
  check('G1-G3-production-acceptance', 'BLOCKED', 'Expected application measurement, full RPC streaming matrix and upgrade/outage boundaries remain unapproved.');
  report.runOutcome = 'COMPLETED_LIMITED_EXPERIMENT';
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), scope: `Own PER probe ${options.mode}; no game/funds payout`, mode: options.mode, status: 'BLOCKED', productionApproval: false, G0: 'BLOCKED', checks: [], rows: [], transactions: [], sessions: {}, leakSearch: [] };
  let journal;
  try {
    const artifacts = await loadArtifacts(), keys = await loadKeys({ create: options.mode === 'prepare' });
    report.localBinarySha256 = artifacts.report.binarySha256;
    report.clientSha256 = sha256(await readFile(new URL('probe-client.mjs', import.meta.url)));
    report.runnerSha256 = sha256(await readFile(new URL('probe-runner.mjs', import.meta.url)));
    report.vrfVisibilitySha256 = sha256(await readFile(new URL('vrf-visibility.mjs', import.meta.url)));
    let plan;
    if (options.mode === 'prepare') {
      try { plan = validatePlan(JSON.parse(await readFile(PLAN, 'utf8')), keys); }
      catch (e) {
        if (e.code !== 'ENOENT') throw e;
        plan = makePlan(keys.inspector.publicKey, [keys.playerA.publicKey, keys.playerB.publicKey], options.roundId ?? BigInt(Date.now()));
        await writeFile(PLAN, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      }
      if (options.roundId !== null && plan.roundId !== BigInt(options.roundId).toString()) throw new Error('Existing plan has a different round ID; no automatic replacement/reroll');
      report.sequence = offlineSequence(artifacts.idl, plan);
      report.checks.push({ id: 'offline-key-idl-account-plan', status: 'PASS' }, { id: 'remote-execution', status: 'BLOCKED', evidence: 'No network requests or signed transactions were submitted by prepare' });
      report.runOutcome = 'PREPARED_OFFLINE';
    } else {
      plan = validatePlan(JSON.parse(await readFile(PLAN, 'utf8')), keys);
      report.plan = plan;
      if (options.mode === 'inspect') {
        report.deployment = await inspectDeployment(artifacts, plan.inspector);
        for (const [role, key] of Object.entries(keys)) report[`${role}BalanceLamports`] = (await rpc(PIN.base, 'getBalance', [key.publicKey.toBase58(), { commitment: 'confirmed' }])).value;
        report.checks.push({ id: 'own-devnet-deployment', status: 'PASS', evidence: report.deployment });
      } else {
        journal = await ProbeWriteJournal.acquire(plan);
        await runExperiment(artifacts, plan, keys, options, report, journal);
      }
    }
    report.plan = plan;
  } catch (e) {
    report.runOutcome = 'BLOCKED';
    report.checks.push({ id: 'execution-prerequisite-or-runtime', status: 'BLOCKED', evidence: safeFailure(e) });
  } finally {
    if (journal) {
      report.writeJournal = journal.summary();
      try { await journal.close(); }
      catch (e) { report.runOutcome = 'BLOCKED'; report.checks.push({ id: 'write-journal-close', status: 'BLOCKED', evidence: safeFailure(e) }); }
    }
  }
  if (report.checks.some(c => c.status === 'FAIL')) report.status = 'FAIL';
  report.finishedAt = new Date().toISOString();
  await saveReport(`probe-${options.mode}-latest`, report);
  return report.status === 'FAIL' ? 1 : options.mode === 'prepare' && report.runOutcome === 'PREPARED_OFFLINE' ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }).catch(e => { console.error(JSON.stringify(safeFailure(e))); process.exitCode = 2; });
}
