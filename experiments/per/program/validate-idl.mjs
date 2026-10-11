export function validateProbeIdl(idl, programId) {
  if (idl?.address !== programId || !Array.isArray(idl.instructions)) throw new Error('Invalid probe IDL envelope');
  const instruction = name => {
    const found = idl.instructions.filter(i => i.name === name);
    if (found.length !== 1 || !Array.isArray(found[0].accounts)) throw new Error(`Missing or ambiguous instruction ${name}`);
    return found[0];
  };
  const account = (ix, name) => {
    const found = ix.accounts.filter(a => a.name === name);
    if (found.length !== 1) throw new Error(`Missing or ambiguous account ${ix.name}.${name}`);
    return found[0];
  };
  const isFalse = flag => flag === undefined || flag === false;
  for (const name of ['delegate_round', 'delegate_receipt']) {
    if (account(instruction(name), 'owner_program').address !== programId) throw new Error(`Wrong owner_program for ${name}`);
  }
  const submit = instruction('submit_probe');
  const round = account(submit, 'round');
  const player = account(submit, 'player');
  const receipt = account(submit, 'receipt');
  if (!isFalse(round.writable) || !isFalse(round.signer)) throw new Error('Private Round must be read-only and nonsigner');
  if (player.signer !== true || !isFalse(player.writable)) throw new Error('Player must be a read-only signer');
  if (receipt.writable !== true || !isFalse(receipt.signer)) throw new Error('Receipt must be writable and nonsigner');
}
