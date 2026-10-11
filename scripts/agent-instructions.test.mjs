import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Files every agent session loads or is told to read first. Anthropic's memory guide
// targets under 200 lines per instruction file; STATUS stays smaller because it is
// rewritten each session and old entries move to docs/handoff/history.md.
const BUDGETS = [
  ['AGENTS.md', 80],
  ['CLAUDE.md', 20],
  ['apps/web/AGENTS.md', 40],
  ['docs/handoff/STATUS.md', 80],
  ['docs/product/ringside-neuroarena-spec.md', 200],
];

for (const [path, maxLines] of BUDGETS) {
  test(`${path} stays within ${maxLines} lines`, async () => {
    const lines = (await readFile(path, 'utf8')).trimEnd().split('\n').length;
    assert.ok(lines <= maxLines, `${path} has ${lines} lines; move detail into a linked doc instead of growing it`);
  });
}

test('documents referenced from AGENTS.md exist', async () => {
  const agents = await readFile('AGENTS.md', 'utf8');
  const paths = [...agents.matchAll(/`((?:docs|apps|scripts)\/[^`\s]+\.(?:md|sh|mjs))`/g)].map(match => match[1]);
  assert.ok(paths.length > 0);
  for (const path of paths) await assert.doesNotReject(readFile(path), `${path} is referenced from AGENTS.md`);
});
