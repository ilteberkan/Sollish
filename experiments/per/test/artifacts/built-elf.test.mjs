import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PIN, loadArtifacts } from '../../probe-client.mjs';
import { sha256 } from '../../lib.mjs';

test('actual locally built SBF ELF matches pinned own source, Cargo.lock, IDL and build report', async () => {
  // Production gate, unchanged: missing/stale actual artifacts FAIL this command.
  // It neither loads private keys nor builds/deploys a program.
  const artifacts = await loadArtifacts();
  const binary = await readFile(new URL('../../program/target/deploy/per_probe.so', import.meta.url));
  assert.equal(artifacts.report.programId, PIN.program);
  assert.equal(artifacts.report.localArtifactConsistency, 'PASS');
  assert.notEqual(artifacts.report.synthetic, true);
  assert.equal(artifacts.report.scope, 'LOCAL BUILD ONLY; NOT DEPLOYED');
  assert(artifacts.binary.equals(binary));
  assert.equal(sha256(binary), artifacts.report.binarySha256);
  assert.equal(binary.length, artifacts.report.binaryBytes);
  assert(binary.length > 64, 'A real ELF needs more than its header');
  assert.equal(binary[4], 2, 'SBF is ELF64');
  assert.equal(binary[5], 1, 'SBF ELF uses little endian');
  assert.equal(binary.readUInt16LE(16), 3, 'Expected ELF shared object');
  assert.equal(binary.readUInt16LE(18), 263, 'Expected pinned SBF v2 EM_SBPF');
});
