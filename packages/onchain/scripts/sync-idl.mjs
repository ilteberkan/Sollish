import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
const definitions = {};
function flatten(accounts, prefix = '') {
  return accounts.flatMap(a => a.accounts
    ? flatten(a.accounts, `${prefix}${a.name}.`)
    : [{ name: `${prefix}${a.name}`, signer: !!a.signer, writable: !!a.writable }]);
}
for (const program of ['house', 'games', 'incentives']) {
  const idl = JSON.parse(await readFile(new URL(`target/idl/${program}.json`, root), 'utf8'));
  const names = program === 'house'
    ? ['initialize_player']
    : program === 'games' ? ['initialize_activity', 'place_coinflip', 'place_coinflip_rewarded', 'settle_coinflip', 'close_coinflip']
    : ['initialize_staker', 'stake', 'unstake', 'claim_staking', 'claim_wager_rewards', 'claim_hourly'];
  const instructions = Object.fromEntries(idl.instructions.filter(i => names.includes(i.name)).map(i => [i.name, {
    discriminator: i.discriminator,
    accounts: flatten(i.accounts),
    args: i.args,
  }]));
  if (Object.keys(instructions).length !== names.length) throw new Error(`Missing instruction: ${program}`);
  const accounts = Object.fromEntries(idl.accounts.map(a => [a.name, {
    discriminator: a.discriminator,
    fields: idl.types.find(t => t.name === a.name).type.fields,
  }]));
  const types = Object.fromEntries(idl.types.filter(t => t.type.kind === 'struct').map(t => [t.name, t.type.fields]));
  definitions[program] = { address: idl.address, instructions, accounts, types };
}
const source = `// Generated from Anchor build IDLs. Run pnpm idl:sync; do not edit.\nexport const schema = ${JSON.stringify(definitions, null, 2)} as const;\n`;
const target = new URL('packages/onchain/src/schema.ts', root);
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== source) throw new Error('Client IDL is stale; run pnpm idl:sync');
  process.stdout.write('Client IDL matches built contracts.\n');
} else {
  await mkdir(new URL('.', target), { recursive: true });
  await writeFile(target, source);
  process.stdout.write(`Updated ${fileURLToPath(target)}\n`);
}
