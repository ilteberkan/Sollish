import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateProbeIdl } from './validate-idl.mjs';

const here = new URL('./', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = await readFile(new URL('src/lib.rs', here));
const config = await readFile(new URL('Anchor.toml', here), 'utf8');
const idlBytes = await readFile(new URL('target/idl/per_probe.json', here));
const idl = JSON.parse(idlBytes);
const binary = await readFile(new URL('target/deploy/per_probe.so', here));
const sourceId = /declare_id!\("([^"]+)"\)/.exec(source.toString())?.[1];
const keyId = execFileSync(fileURLToPath(new URL('../../../.tooling/agave/4.1.2/bin/solana-keygen', here)), ['pubkey', fileURLToPath(new URL('../../../.tooling/per/probe-program-keypair.json', here))], { encoding: 'utf8' }).trim();
const configured = [...config.matchAll(/^per_probe = "([^"]+)"$/gm)].map(x => x[1]);
if (!sourceId || sourceId !== idl.address || sourceId !== keyId || configured.length !== 2 || configured.some(x => x !== sourceId)) throw new Error('Source / IDL / owned key / Anchor config addresses do not match');
validateProbeIdl(idl, sourceId);
if (!binary.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new Error('Artifact is not ELF');
const report = {
  generatedAt: new Date().toISOString(), scope: 'LOCAL BUILD ONLY; NOT DEPLOYED',
  localArtifactConsistency: 'PASS', programId: sourceId,
  binaryBytes: binary.length, binarySha256: hash(binary), sourceSha256: hash(source), idlSha256: hash(idlBytes),
  cargoLockSha256: hash(await readFile(new URL('Cargo.lock', here))),
  programIds: { source: sourceId, idl: idl.address, ownedKey: keyId, anchorConfigurations: configured },
  sdk: { anchor: '1.2.0', ephemeralRollups: '0.16.2', ephemeralVrf: '0.4.1', hostRust: '1.95.0' },
  commitFrequencyMs: 4294967295, commitFrequencyMeaning: 'Finite interval (~49.7 days); automatic commit disabled is NOT proven',
  instructions: idl.instructions.map(i => i.name),
  G0OwnedDeployment: 'BLOCKED: no devnet deployment', G1: 'BLOCKED: not run on PER', G2: 'BLOCKED: not run on PER', G3: 'BLOCKED: not run on PER',
  inspectorCanRead: true, operatorBlindClaim: false,
};
await mkdir(new URL('artifacts/', here), { recursive: true });
await writeFile(new URL('artifacts/own-probe-build.json', here), JSON.stringify(report, null, 2) + '\n');
await writeFile(new URL('artifacts/per_probe.idl.json', here), idlBytes);
console.log(JSON.stringify({ localArtifactConsistency: 'PASS', programId: sourceId, binaryBytes: binary.length, G0OwnedDeployment: 'BLOCKED' }));
