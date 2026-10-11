import { readFile } from 'node:fs/promises';
import { sha256 } from '../../lib.mjs';
import { PIN, validateLocalArtifacts } from '../../probe-client.mjs';

/** Pure unit fixture, NOT executable SBF and NOT deployment/build evidence.
 * Only public checked-in IDL/source/lock/report fields are read. The real
 * target/deploy binary and private program/payer keys are never read here. */
export async function syntheticArtifacts() {
  // helpers/ is inside test/, so reach the experiment's program directory.
  const program = new URL('../../program/', import.meta.url);
  const [idlBytes, source, lock, reportBytes] = await Promise.all([
    readFile(new URL('artifacts/per_probe.idl.json', program)),
    readFile(new URL('src/lib.rs', program)),
    readFile(new URL('Cargo.lock', program)),
    readFile(new URL('artifacts/own-probe-build.json', program)),
  ]);
  const shape = JSON.parse(reportBytes);
  const binary = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from('SYNTHETIC_UNIT_TEST_BYTES_NOT_EXECUTABLE_SBF')]);
  const report = {
    ...shape, generatedAt: null, scope: 'SYNTHETIC NODE UNIT FIXTURE; NOT A BUILD OR DEPLOYMENT',
    synthetic: true, programId: PIN.program, localArtifactConsistency: 'PASS',
    binaryBytes: binary.length, binarySha256: sha256(binary),
    sourceSha256: sha256(source), idlSha256: sha256(idlBytes), cargoLockSha256: sha256(lock),
  };
  const input = { idlBytes, source, lock, binary, report };
  return { ...validateLocalArtifacts(input), input };
}
