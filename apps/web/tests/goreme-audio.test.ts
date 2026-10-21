import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GOREME_CALLOUT_CLASSES, GOREME_CLASS_VOICE, GOREME_LADDER, GOREME_PLACEHOLDER, GOREME_REEL_STEPS, GOREME_SYMBOL_IDS, GOREME_SYMBOL_SEMITONES, GOREME_TIER_VOICE,
  GOREME_VOCALS, GOREME_VOICE_LINES, GOREME_VOICE_PRIORITY, GOREME_VOICE_TEXT, GOREME_VOICE_TEXT_EN,
  balloonClass, balloonSemitones, burnerHeat, goremeCalloutClass, goremeVoiceBankUrls, goremeVoiceDecision, loadGoremeVoiceBank, mergeSize, reelPan, skySemitones, sunTeases, waysGrade, windSweep,
} from '../lib/slot-audio/goreme-tiers';
import { voiceCategory } from '../lib/slot-audio/voice-policy';
import { voiceBankFolder, voiceLanguageOf } from '../lib/slot-audio/voice-locale';
import { GOREME_SFX } from '../lib/slot-audio/sfx/goreme';
import { playGoremeStep, GOREME_VOICE_BANK } from '../lib/slot-audio/use-goreme-sound';

const F_PENTA = new Set([5, 7, 9, 0, 2]);
const pc = (semi: number) => (((77 + semi) % 12) + 12) % 12;

test('voice stems and texts match docs/product/voice-scripts.md exactly (both languages)', () => {
  const doc = readFileSync(resolve(import.meta.dirname, '../../../docs/product/voice-scripts.md'), 'utf8');
  const section = doc.slice(doc.indexOf('## Göreme: Şafak Balonları'), doc.indexOf('## Candy Cascade'));
  const rows = [...section.matchAll(/^\| `([^`]+)` \| [^|]+\| ([^|]+) \| ([^|]+) \|$/gm)].map(m => ({ stem: m[1]!, tr: m[2]!.trim(), en: m[3]!.trim() }));
  assert.equal(rows.length, 18);
  assert.deepEqual(rows.map(r => r.stem), [...GOREME_VOICE_LINES]);
  for (const r of rows) {
    assert.equal(GOREME_VOICE_TEXT[r.stem as never], r.tr, r.stem);
    assert.equal(GOREME_VOICE_TEXT_EN[r.stem as never], r.en, r.stem);
  }
});

test('voice lines map into the shared policy categories as intended', () => {
  assert.equal(voiceCategory('x2-9'), 'minor');
  for (const l of ['x10', 'x25', 'x50', 'x100']) assert.equal(voiceCategory(l), 'callout', l);
  for (const l of ['win-big', 'win-epic']) assert.equal(voiceCategory(l), 'tier', l);
  for (const l of ['feature-trigger', 'feature-start', 'feature-end', 'retrigger']) assert.equal(voiceCategory(l), 'feature', l);
  assert.equal(voiceCategory('nice'), 'ambient');
  for (const l of ['lift', 'wind', 'merge', 'sun-tease', 'moor', 'sky-10']) assert.equal(voiceCategory(l), 'moment', l);
});

test('tier and callout mapping: Büyük–Süper → win-big, Efsane/max → win-epic; classes clamp at ×100', () => {
  assert.deepEqual({ ...GOREME_TIER_VOICE }, { 1: 'win-big', 2: 'win-big', 3: 'win-big', 4: 'win-epic', max: 'win-epic' });
  assert.equal(goremeCalloutClass(1), 'x2'); assert.equal(goremeCalloutClass(9.99), 'x2'); assert.equal(goremeCalloutClass(10), 'x10');
  assert.equal(goremeCalloutClass(25), 'x25'); assert.equal(goremeCalloutClass(50), 'x50'); assert.equal(goremeCalloutClass(100), 'x100');
  assert.equal(goremeCalloutClass(15_625), 'x100'); assert.equal(goremeCalloutClass(Number.NaN), 'x2');
  for (const c of GOREME_CALLOUT_CLASSES) assert.ok(GOREME_VOICE_LINES.includes(GOREME_CLASS_VOICE[c]));
  const ids = new Set(GOREME_SFX.map(d => d.id));
  for (const c of GOREME_CALLOUT_CLASSES) assert.ok(ids.has(`callout-${c}`), c);
  for (const t of [2, 3, 4, 'max']) assert.ok(ids.has(`tier-up-${t}`));
  for (const t of [1, 2, 3, 4, 'max']) assert.ok(ids.has(`count-land-${t}`));
});

test('placeholders exist as rendered effects; every line has a priority; ×10+ and tier lines have a wordless stand-in', () => {
  const ids = new Set(GOREME_SFX.map(d => d.id));
  for (const v of GOREME_VOCALS) assert.ok(ids.has(v), v);
  for (const l of GOREME_VOICE_LINES) {
    const p = GOREME_PLACEHOLDER[l];
    if (p) assert.ok(GOREME_VOCALS.includes(p));
    assert.ok(GOREME_VOICE_PRIORITY[l] >= 1);
  }
  for (const l of ['x10', 'x25', 'x50', 'x100', 'win-big', 'win-epic', 'feature-trigger'] as const) assert.ok(GOREME_PLACEHOLDER[l], l);
  assert.equal(goremeVoiceDecision(null, 'x10', 0), 'play');
  assert.equal(goremeVoiceDecision({ line: 'merge', until: 2 }, 'win-epic', 1), 'replace');
  assert.equal(goremeVoiceDecision({ line: 'win-epic', until: 2 }, 'merge', 1), 'skip');
  assert.equal(goremeVoiceDecision({ line: 'win-epic', until: 2 }, 'merge', 1.9), 'play');
});

test('voice bank layout /audio/voice/goreme/<tr|en>/<stem>.mp3; a folder without files costs no request; failures stay silent', async () => {
  assert.equal(voiceBankFolder(GOREME_VOICE_BANK, voiceLanguageOf('tr-TR')), '/audio/voice/goreme/tr');
  assert.equal(voiceBankFolder(GOREME_VOICE_BANK, voiceLanguageOf('de')), '/audio/voice/goreme/en');
  const plain = goremeVoiceBankUrls('/audio/voice/goreme/tr/');
  for (const l of GOREME_VOICE_LINES) assert.ok(plain[l]!.startsWith(`/audio/voice/goreme/tr/${l}.mp3`), l);
  const gated = goremeVoiceBankUrls('/audio/voice/goreme/tr', { requireVersion: true });
  assert.ok(GOREME_VOICE_LINES.every(l => gated[l] === null), 'no generated version yet → no URLs (the mp3 files do not exist)');
  let calls = 0;
  const none = await loadGoremeVoiceBank(gated, async () => { calls++; return 1; });
  assert.equal(calls, 0); assert.ok([...none.values()].every(v => v === null));
  const mixed = await loadGoremeVoiceBank(plain, async url => { if (url.includes('/x10.mp3')) return 'buf'; if (url.includes('/x25.mp3')) throw new Error('404'); return null; });
  assert.equal(mixed.get('x10'), 'buf'); assert.equal(mixed.get('x25'), null); assert.equal(mixed.get('win-big'), null);
  const custom = goremeVoiceBankUrls({ x10: '/a.mp3', x25: ' ' });
  assert.equal(custom.x10, '/a.mp3'); assert.equal(custom.x25, null);
});

test('pitch maps stay on the F major pentatonic; reels pan left → right; balloons, merges and sky climb', () => {
  for (const s of GOREME_LADDER) assert.ok(F_PENTA.has(pc(s)), String(s));
  for (const s of GOREME_REEL_STEPS) assert.ok(F_PENTA.has(pc(s)));
  for (const id of GOREME_SYMBOL_IDS) assert.ok(F_PENTA.has(pc(GOREME_SYMBOL_SEMITONES[id])), id);
  assert.equal(new Set(GOREME_SYMBOL_IDS.map(id => GOREME_SYMBOL_SEMITONES[id])).size, 9, 'nine distinct symbol tones');
  for (let r = 1; r < 6; r++) { assert.ok(reelPan(r) > reelPan(r - 1)); assert.ok(GOREME_REEL_STEPS[r]! > GOREME_REEL_STEPS[r - 1]!); }
  assert.deepEqual([1, 2, 3, 5, 9, 10, 25].map(balloonClass), [1, 2, 2, 3, 3, 4, 4]);
  let prev = -99;
  for (const m of [1, 2, 4, 8, 16, 25]) { const s = balloonSemitones(m); assert.ok(s > prev && F_PENTA.has(pc(s))); prev = s; }
  assert.equal(mergeSize(2), 1); assert.equal(mergeSize(25), 2); assert.ok(mergeSize(10) > 1 && mergeSize(10) < 2);
  prev = -99;
  for (const v of [1, 2, 4, 8, 16, 32]) { const s = skySemitones(v); assert.ok(s >= prev && F_PENTA.has(pc(s))); prev = s; }
  assert.ok(skySemitones(32) > skySemitones(1));
  assert.deepEqual([0.2, 1, 4.99, 5, 19, 20, 500].map(waysGrade), [0, 1, 1, 2, 2, 3, 3]);
  assert.deepEqual(windSweep('left'), { from: 0.85, to: -0.85, calm: false });
  assert.deepEqual(windSweep('right'), { from: -0.85, to: 0.85, calm: false });
  assert.equal(windSweep('calm').calm, true);
  assert.ok(burnerHeat(5, 10) > burnerHeat(1, 1) && burnerHeat(99, 99) <= 1);
  assert.equal(sunTeases(2), true); assert.equal(sunTeases(3), false);
});

test('engine steps map to sound events (the game screen path)', () => {
  const calls: [string, ...unknown[]][] = [];
  const c = (name: string, ...args: unknown[]) => { calls.push([name, ...args]); return name === 'lift' ? 1.7 : undefined; };
  playGoremeStep(c, { type: 'spin', balloons: [{ col: 2, multiplier: 3 }] });
  assert.deepEqual(calls.map(x => x[0]), ['spinStart', 'reelStop', 'reelStop', 'reelStop', 'reelStop', 'reelStop', 'reelStop', 'balloonLand']);
  assert.deepEqual(calls.at(-1), ['balloonLand', 3, 2]);
  calls.length = 0;
  playGoremeStep(c, { type: 'ways', winHundredths: 1250, skyMultiplier: 1, wins: [{ symbol: 'l2', multiplierProduct: 1, payTenThousandths: 100 }, { symbol: 'h1', multiplierProduct: 6, payTenThousandths: 900 }] });
  assert.deepEqual(calls, [['waysWin', 'h1', 12.5], ['multiplierCallout', 6]]);
  calls.length = 0;
  playGoremeStep(c, { type: 'ways', winHundredths: 0, wins: [] });
  assert.equal(calls.length, 0);
  assert.equal(playGoremeStep(c, { type: 'lift', lift: 1, wind: 'left', merges: [{ multiplier: 7 }], exits: [{ multiplier: 4, moored: true }], balloons: [1, 2] }), 1.7);
  assert.deepEqual(calls[0], ['lift', { wind: 'left', lift: 1, balloons: 2, merges: [7], exits: [{ multiplier: 4, moored: true }] }]);
  calls.length = 0;
  playGoremeStep(c, { type: 'scatter', count: 3, freeSpins: 10 });
  playGoremeStep(c, { type: 'scatter', count: 3, freeSpins: 5 }, { kind: 'free' });
  playGoremeStep(c, { type: 'scatter', count: 2, freeSpins: 0 });
  playGoremeStep(c, { type: 'sky', skyBefore: 3, skyAfter: 11 });
  playGoremeStep(c, { type: 'respin', balloons: [] });
  assert.deepEqual(calls.map(x => x[0]), ['featureTrigger', 'retrigger', 'sunTease', 'skyMultiplier', 'respin']);
});
