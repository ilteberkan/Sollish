import { readFile } from 'node:fs/promises';
import { ROOT, redact, rpc, saveReport, wallet } from './lib.mjs';

// This command never deploys, transfers funds, or sends a signed transaction.
// One fixed request per invocation to a public devnet faucet; no endpoint override.
const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), scope: 'One free devnet faucet request to our dedicated wallet only', status: 'BLOCKED', checks: [] };
try {
  const genesis = await rpc('https://api.devnet.solana.com', 'getGenesisHash');
  if (genesis !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' || genesis !== manifest.devnetGenesisHash) throw new Error('Refusing faucet: genesis is not pinned devnet');
  const own = await wallet();
  report.publicKey = own.pubkey;
  report.before = await rpc(manifest.baseRpc, 'getBalance', [own.pubkey, { commitment: 'confirmed' }]);
  if (report.before.value >= 2_000_000_000) {
    report.checks.push({ id: 'faucet', status: 'PASS', evidence: 'Existing test balance sufficient; no new request.' });
    report.status = 'PASS';
  } else {
    report.requestedDevnetLamports = 2_000_000_000;
    report.signature = await rpc('https://api.devnet.solana.com', 'requestAirdrop', [own.pubkey, report.requestedDevnetLamports, { commitment: 'confirmed' }]);
    // Bounded polling, with the public signature kept as evidence.
    for (let n = 0; n < 10; n++) {
      const result = await rpc(manifest.baseRpc, 'getSignatureStatuses', [[report.signature], { searchTransactionHistory: true }]);
      const status = result.value?.[0];
      if (status?.err) throw new Error('Faucet transaction failed');
      if (['confirmed', 'finalized'].includes(status?.confirmationStatus)) { report.confirmation = status; break; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    report.after = await rpc(manifest.baseRpc, 'getBalance', [own.pubkey, { commitment: 'confirmed' }]);
    if (!report.confirmation || report.after.value - report.before.value < report.requestedDevnetLamports) throw new Error('Faucet confirmation/balance increase not observed');
    report.status = 'PASS';
    report.checks.push({ id: 'faucet', status: 'PASS', evidence: 'Confirmed free devnet SOL only; no transfer/deployment performed.' });
  }
} catch (e) {
  report.checks.push({ id: 'faucet', status: 'BLOCKED', evidence: redact(e.message) });
}
report.finishedAt = new Date().toISOString();
await saveReport('faucet-latest', report);
process.exitCode = report.status === 'PASS' ? 0 : 2;
