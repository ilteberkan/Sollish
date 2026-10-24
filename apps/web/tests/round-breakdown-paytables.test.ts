/* The paytables on the info pages equal the engine: size/length labels cover exactly the sizes the engine pays with that
   column, the pay values are read from the engine constants (no hard-coded copy in the page source), and the count labels
   of the scatter rows in every locale name the same counts as the engine's scatter tables. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASENA_PAYTABLE, ASENA_SCATTER_PAY, CASCADE2_PAYTABLE, CASCADE2_SCATTER_PAY, CEZERI_GEAR_PAY, CEZERI_PAYTABLE, CEZERI_SCATTER_PAY,
  DAMLA_PAYTABLES, EBRU_CLUSTER_TIER_STARTS, EBRU_PAYTABLE, EBRU_SCATTER_PAY, GOREME_PAYTABLE, GOREME_SCATTER_AWARDS, STORM_PAYTABLE, STORM_SCATTER_PAY,
  __cascade2Test, __ebruTest, __stormTest, asenaTier,
  type CascadeGrid, type StormGrid,
} from '@sollish/protocol';
import { ASENA_TIER_LABELS, EBRU_TIER_LABELS, GOREME_LENGTHS, TUMBLE8_TIER_LABELS, labelRange } from '../lib/paytable-labels';
import { LOCALES } from '../lib/i18n/config';

const ROOT = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** For every size 1..max: the label whose range holds it must be the engine's tier (or none below the minimum). */
function checkLabels(labels: readonly string[], tierOf: (size: number) => number | null, max: number) {
  for (let size = 1; size <= max; size++) {
    const engine = tierOf(size);
    const shown = labels.findIndex(l => { const [a, b] = labelRange(l); return size >= a && size <= b; });
    assert.equal(shown === -1 ? null : shown, engine, `size ${size}: label ${labels[shown]} vs engine tier ${engine}`);
  }
}
/** Engine tier of an n-symbol scatter-pays win, measured through the engine's own win search on a 6x5 grid. */
function tumbleTier(n: number, find: (grid: CascadeGrid & StormGrid) => { symbol: string; payHundredths: number }[], target: string, table: readonly number[], fillers: readonly string[]): number | null {
  const cells: string[] = [];
  for (let i = 0; i < n; i++) cells.push(target);
  for (let i = 0; cells.length < 30; i++) cells.push(fillers[i % fillers.length]!);
  let id = 0;
  const grid = Array.from({ length: 6 }, (_, c) => Array.from({ length: 5 }, (_, r) => ({ id: id++, symbol: cells[c * 5 + r]! }))) as never;
  const win = find(grid).find(w => w.symbol === target);
  if (!win) return null;
  const tier = table.indexOf(win.payHundredths);
  assert.ok(tier >= 0);
  return tier;
}

test('Candy Cascade and Tarhun: size labels 8–9 / 10–11 / 12+ match the engine tiers', () => {
  const cascadeFill = ['cupcake', 'donut', 'gumdrop', 'strawberry', 'blueberry', 'kiwi', 'lemon', 'cherry'];
  checkLabels(TUMBLE8_TIER_LABELS, n => tumbleTier(n, g => __cascade2Test.findWins(g), 'crown', CASCADE2_PAYTABLE.crown, cascadeFill), 30);
  const stormFill = ['h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4', 'l5'];
  checkLabels(TUMBLE8_TIER_LABELS, n => tumbleTier(n, g => __stormTest.findWins(g), 'h1', STORM_PAYTABLE.h1, stormFill), 30);
  assert.equal(TUMBLE8_TIER_LABELS.length, CASCADE2_PAYTABLE.crown.length);
  assert.equal(TUMBLE8_TIER_LABELS.length, STORM_PAYTABLE.h1.length);
});
test('Asena: seven size labels match asenaTier and the paytable width', () => {
  checkLabels(ASENA_TIER_LABELS, n => (n < 5 ? null : asenaTier(n)), 36);
  for (const row of Object.values(ASENA_PAYTABLE)) assert.equal(row.length, ASENA_TIER_LABELS.length);
});
test('Ebru: size labels come from EBRU_CLUSTER_TIER_STARTS and match the engine tier function', () => {
  checkLabels(EBRU_TIER_LABELS, n => (n < EBRU_CLUSTER_TIER_STARTS[0]! ? null : __ebruTest.tierOf(n)), 49);
  for (const row of Object.values(EBRU_PAYTABLE)) assert.equal(row.length, EBRU_TIER_LABELS.length);
});
test('Göreme: one length column per paytable column, 3..6 reels', () => {
  assert.deepEqual([...GOREME_LENGTHS], [3, 4, 5, 6]);
  for (const row of Object.values(GOREME_PAYTABLE)) assert.equal(row.length, GOREME_LENGTHS.length);
});
test('Cezeri: 3 and 4 slice columns, gear and vessel rows match the engine tables', () => {
  for (const row of Object.values(CEZERI_PAYTABLE)) assert.equal(row.length, 2);
  assert.equal(CEZERI_GEAR_PAY.length, 2);
});

test('info pages read every pay value from the engine constants (no hard-coded copy in the source)', () => {
  const pages: [string, string[], number[]][] = [
    ['components/cascade/paytable.tsx', ['CASCADE2_PAYTABLE', 'CASCADE2_SCATTER_PAY'], [...Object.values(CASCADE2_PAYTABLE).flat(), ...Object.values(CASCADE2_SCATTER_PAY)]],
    ['components/storm/storm-info-pages.tsx', ['STORM_PAYTABLE', 'STORM_SCATTER_PAY'], [...Object.values(STORM_PAYTABLE).flat(), ...Object.values(STORM_SCATTER_PAY)]],
    ['components/ebru/ebru-info-pages.tsx', ['EBRU_PAYTABLE', 'EBRU_SCATTER_PAY'], [...Object.values(EBRU_PAYTABLE).flat(), ...Object.values(EBRU_SCATTER_PAY)]],
    ['components/cezeri/cezeri-info-pages.tsx', ['CEZERI_PAYTABLE', 'CEZERI_GEAR_PAY', 'CEZERI_SCATTER_PAY'], [...Object.values(CEZERI_PAYTABLE).flat(), ...CEZERI_GEAR_PAY, ...Object.values(CEZERI_SCATTER_PAY)]],
    ['components/asena/asena-info-pages.tsx', ['ASENA_PAYTABLE', 'ASENA_SCATTER_PAY'], [...Object.values(ASENA_PAYTABLE).flat(), ...Object.values(ASENA_SCATTER_PAY)]],
    ['components/goreme/goreme-info-pages.tsx', ['GOREME_PAYTABLE', 'GOREME_SCATTER_AWARDS'], [...Object.values(GOREME_PAYTABLE).flat(), ...Object.values(GOREME_SCATTER_AWARDS).map(a => a.payHundredths)]],
    ['components/damla/damla-info-pages.tsx', ['DAMLA_PAYTABLES'], Object.values(DAMLA_PAYTABLES).flat()],
  ];
  for (const [path, constants, values] of pages) {
    const source = read(path);
    for (const name of constants) assert.match(source, new RegExp(`\\b${name}\\b`), `${path} reads ${name}`);
    // Distinctive values (3+ digits) must not appear as literals: the page would then show a copy, not the engine table.
    const literals = new Set((source.match(/(?<![\w.#-])\d[\d_]{2,}(?![\w.%])/g) ?? []).map(s => Number(s.replace(/_/g, ''))));
    // 1000 and 1_000_000 also appear as the comb's sine scale and the "millions of rounds" divisor, not as pay values.
    const notPay = new Set([1000, 1_000_000]);
    const copied = [...new Set(values.filter(v => v >= 100 && !notPay.has(v) && literals.has(v)))];
    assert.deepEqual(copied, [], `${path} hard-codes engine pay values ${copied.join(', ')}`);
  }
});

test('scatter row labels name the engine scatter counts in every locale', () => {
  const groups: [string, string, number[]][] = [
    ['cascade', 'stars', Object.keys(CASCADE2_SCATTER_PAY).map(Number)],
    ['tarhun', 'seals', Object.keys(STORM_SCATTER_PAY).map(Number)],
    ['ebru', 'combs', Object.keys(EBRU_SCATTER_PAY).map(Number)],
    ['cezeri', 'vessels', Object.keys(CEZERI_SCATTER_PAY).map(Number)],
    ['cezeri', 'gears', [3, 4]],
    ['cezeri', 'slices', [3, 4]],
    ['asena', 'moon', Object.keys(ASENA_SCATTER_PAY).map(Number)],
  ];
  for (const locale of LOCALES) {
    for (const [game, prefix, counts] of groups) {
      const pay = JSON.parse(read(`messages/${locale}/${game}.json`)).info.pay as Record<string, string>;
      const keys = Object.keys(pay).filter(k => new RegExp(`^${prefix}\\d+$`).test(k)).map(k => Number(k.slice(prefix.length))).sort((a, b) => a - b);
      assert.deepEqual(keys, [...counts].sort((a, b) => a - b), `${locale}/${game} ${prefix} keys`);
      for (const n of counts) assert.match(pay[`${prefix}${n}`]!, new RegExp(`(^|\\D)${n}(\\D|$)`), `${locale}/${game} ${prefix}${n} names ${n}`);
    }
  }
});
