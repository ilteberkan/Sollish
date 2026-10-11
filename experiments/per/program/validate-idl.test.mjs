import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProbeIdl } from './validate-idl.mjs';

const id = 'owned-program';
const fixture = () => ({ address: id, instructions: [
  { name: 'delegate_round', accounts: [{ name: 'owner_program', address: id }] },
  { name: 'delegate_receipt', accounts: [{ name: 'owner_program', address: id }] },
  { name: 'submit_probe', accounts: [{ name: 'round' }, { name: 'player', signer: true }, { name: 'receipt', writable: true }] },
] });

test('expected IDL account roles validate', () => validateProbeIdl(fixture(), id));
test('missing, duplicate and wrongly privileged private Round cannot pass', () => {
  for (const change of [
    xs => xs.filter(a => a.name !== 'round'),
    xs => [...xs, { name: 'round' }],
    xs => xs.map(a => a.name === 'round' ? { ...a, writable: true } : a),
    xs => xs.map(a => a.name === 'round' ? { ...a, signer: true } : a),
    xs => xs.filter(a => a.name !== 'player'),
    xs => xs.map(a => a.name === 'player' ? { ...a, signer: false } : a),
    xs => xs.filter(a => a.name !== 'receipt'),
    xs => xs.map(a => a.name === 'receipt' ? { ...a, writable: false } : a),
  ]) {
    const input = fixture(); input.instructions[2].accounts = change(input.instructions[2].accounts);
    assert.throws(() => validateProbeIdl(input, id));
  }
});
test('each delegate instruction must contain one correctly pinned owner_program', () => {
  for (const index of [0, 1]) {
    for (const accounts of [[], [{ name: 'owner_program', address: 'foreign' }], [{ name: 'owner_program', address: id }, { name: 'owner_program', address: id }]]) {
      const input = fixture(); input.instructions[index].accounts = accounts;
      assert.throws(() => validateProbeIdl(input, id));
    }
    const input = fixture(); input.instructions.splice(index, 1);
    assert.throws(() => validateProbeIdl(input, id));
  }
});
