import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SLOT_SETTINGS, SPIN_SPEED_FACTOR, effectiveVolume, loadSettings, sanitizeSettings, saveSettings, settingsStorageKeys, type SettingsStorage, type SlotSettings,
} from '../lib/slot-kit/settings';

function memoryStorage(initial: Record<string, string> = {}): SettingsStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}
const throwing: SettingsStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };

test('defaults match the requirements', () => {
  assert.deepEqual({ ...DEFAULT_SLOT_SETTINGS }, {
    master: 0.9, music: 0.6, sfx: 0.8, ambience: 0.4, muted: true, spinSpeed: 'normal', skipScreens: false, spaceToSpin: true, reducedEffects: false, introScreen: true, voice: 'key',
  });
  assert.ok(Object.isFrozen(DEFAULT_SLOT_SETTINGS));
  assert.deepEqual({ ...loadSettings('candy-cascade', memoryStorage()) }, { ...DEFAULT_SLOT_SETTINGS });
});

test('save then load round-trips through two namespaced keys', () => {
  const storage = memoryStorage();
  const custom: SlotSettings = { master: 0.5, music: 0.1, sfx: 0.2, ambience: 0.3, muted: false, spinSpeed: 'turbo', skipScreens: true, spaceToSpin: false, reducedEffects: true, introScreen: false, voice: 'full' };
  assert.equal(saveSettings('candy-cascade', custom, storage), true);
  assert.deepEqual([...storage.data.keys()].sort(), ['sollish:slot:game:candy-cascade', 'sollish:slot:shared']);
  assert.deepEqual(loadSettings('candy-cascade', storage), custom);
});

test('shared fields carry over to another game; per-game fields do not', () => {
  const storage = memoryStorage();
  saveSettings('game-a', { ...DEFAULT_SLOT_SETTINGS, master: 0.3, muted: false, spinSpeed: 'quick', music: 0.05, introScreen: false }, storage);
  const b = loadSettings('game-b', storage);
  assert.equal(b.master, 0.3);
  assert.equal(b.muted, false);
  assert.equal(b.spinSpeed, 'quick');
  assert.equal(b.music, DEFAULT_SLOT_SETTINGS.music);
  assert.equal(b.introScreen, true);
});

test('stored JSON is validated and clamped', () => {
  const hostile = JSON.stringify({ master: 7, music: -3, sfx: 'loud', ambience: null, muted: 'no', spinSpeed: 'warp', skipScreens: 1, spaceToSpin: 'false', reducedEffects: [], introScreen: {}, __proto__: { master: 0 }, extra: true });
  const s = sanitizeSettings(JSON.parse(hostile));
  assert.equal(s.master, 1);
  assert.equal(s.music, 0);
  assert.equal(s.sfx, DEFAULT_SLOT_SETTINGS.sfx);
  assert.equal(s.ambience, DEFAULT_SLOT_SETTINGS.ambience);
  assert.equal(s.muted, true);
  assert.equal(s.spinSpeed, 'normal');
  assert.equal(s.skipScreens, false);
  assert.equal(s.spaceToSpin, true);
  assert.equal(s.reducedEffects, false);
  assert.equal(s.introScreen, true);
  assert.equal('extra' in s, false);
  assert.equal(sanitizeSettings({ master: Number.NaN, music: Infinity }).master, 0.9);
  assert.equal(sanitizeSettings({ music: 0.123456 }).music, 0.12);
  for (const junk of [null, undefined, 5, 'x', [], [1, 2]]) assert.deepEqual(sanitizeSettings(junk), { ...DEFAULT_SLOT_SETTINGS });
});

test('corrupt, oversized or missing storage falls back to defaults', () => {
  const corrupt = memoryStorage({ 'sollish:slot:shared': '{not json', 'sollish:slot:game:g': '[1,2' });
  assert.deepEqual(loadSettings('g', corrupt), { ...DEFAULT_SLOT_SETTINGS });
  const huge = memoryStorage({ 'sollish:slot:shared': JSON.stringify({ master: 0.1, pad: 'x'.repeat(10_000) }) });
  assert.equal(loadSettings('g', huge).master, DEFAULT_SLOT_SETTINGS.master);
  assert.deepEqual(loadSettings('g', null), { ...DEFAULT_SLOT_SETTINGS });
  assert.deepEqual(loadSettings('g', throwing), { ...DEFAULT_SLOT_SETTINGS });
});

test('saveSettings reports failure without throwing and clamps what it writes', () => {
  assert.equal(saveSettings('g', { ...DEFAULT_SLOT_SETTINGS }, throwing), false);
  assert.equal(saveSettings('g', { ...DEFAULT_SLOT_SETTINGS }, null), false);
  const storage = memoryStorage();
  saveSettings('g', { ...DEFAULT_SLOT_SETTINGS, master: 99, spinSpeed: 'bogus' as never }, storage);
  const shared = JSON.parse(storage.data.get('sollish:slot:shared') ?? '{}');
  assert.equal(shared.master, 1);
  assert.equal(shared.spinSpeed, 'normal');
});

test('the per-game record cannot override shared fields and vice versa', () => {
  const storage = memoryStorage({
    'sollish:slot:shared': JSON.stringify({ master: 0.2, music: 0.99, introScreen: false }),
    'sollish:slot:game:g': JSON.stringify({ master: 0.8, music: 0.4, muted: false }),
  });
  const s = loadSettings('g', storage);
  assert.equal(s.master, 0.2);
  assert.equal(s.music, 0.4);
  assert.equal(s.muted, true);
  assert.equal(s.introScreen, true);
});

test('game ids are validated so keys cannot be forged', () => {
  for (const id of ['', 'A', 'a b', '../x', 'a:b', '-a', 'x'.repeat(49)]) assert.throws(() => settingsStorageKeys(id), RangeError, id);
  assert.deepEqual(settingsStorageKeys('candy-cascade'), { shared: 'sollish:slot:shared', game: 'sollish:slot:game:candy-cascade' });
});

test('effective volume multiplies master by channel and is zero while muted', () => {
  const s: SlotSettings = { ...DEFAULT_SLOT_SETTINGS, muted: false };
  assert.equal(effectiveVolume(s, 'music'), 0.54);
  assert.equal(effectiveVolume(s, 'sfx'), 0.72);
  assert.equal(effectiveVolume(s, 'ambience'), 0.36);
  assert.equal(effectiveVolume({ ...s, muted: true }, 'sfx'), 0);
  assert.equal(effectiveVolume({ ...s, master: 0 }, 'music'), 0);
  assert.ok(SPIN_SPEED_FACTOR.turbo < SPIN_SPEED_FACTOR.quick && SPIN_SPEED_FACTOR.quick < SPIN_SPEED_FACTOR.normal);
});
