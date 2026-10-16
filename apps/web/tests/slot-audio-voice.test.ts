import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIENT_COOLDOWN, MIN_GAP, MINOR_COOLDOWN, REPEAT_WINDOW, createVoicePolicy, sanitizeVoiceLevel, voiceCategory, voicePolicyInput,
} from '../lib/slot-audio/voice-policy';
import { LOCALE_EVENT, onVoiceLanguageChange, voiceBankFolder, voiceLanguage, voiceLanguageOf } from '../lib/slot-audio/voice-locale';
import { STORM_VOICE_LINES } from '../lib/slot-audio/storm-tiers';
import { EBRU_VOICE_LINES } from '../lib/slot-audio/ebru-tiers';
import { CEZERI_VOICE_LINES } from '../lib/slot-audio/cezeri-tiers';
import { ASENA_VOICE_LINES } from '../lib/slot-audio/asena-tiers';
import { MULTIPLIER_CLASSES } from '../lib/slot-audio/win-tiers';
import { DEFAULT_SLOT_SETTINGS, sanitizeSettings } from '../lib/slot-kit/settings';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/* ---------------- categories ---------------- */

test('every voice line of every game has a category: tiers, callouts, features, ambient, minor, moments', () => {
  assert.equal(voiceCategory('win-max'), 'tier');
  assert.equal(voiceCategory('win-big'), 'tier');
  for (const l of ['x10', 'x25', 'x50', 'x100', 'x250', 'x500']) assert.equal(voiceCategory(l), 'callout', l);
  assert.equal(voiceCategory('x2-9'), 'minor'); assert.equal(voiceCategory('x2'), 'minor');
  for (const l of ['feature-trigger', 'feature-start', 'feature-end', 'retrigger', 'map-spins', 'mult-2', 'mult-3', 'mult-5', 'chain-max']) assert.equal(voiceCategory(l), 'feature', l);
  assert.equal(voiceCategory('nice'), 'ambient'); assert.equal(voiceCategory('laugh'), 'ambient');
  for (const l of ['scatter-tease', 'lock', 'chain-3', 'chain-6', 'reservoir', 'falcon', 'sky-open', 'tpl-yay', 'wolf-guides', 'moon-tease', 'comb']) assert.equal(voiceCategory(l), 'moment', l);
  const all = new Set<string>([...STORM_VOICE_LINES, ...EBRU_VOICE_LINES, ...CEZERI_VOICE_LINES, ...ASENA_VOICE_LINES, ...MULTIPLIER_CLASSES]);
  assert.ok(all.size > 25);
  // no multiplier callout below ×10 is ever a "callout" (only the rate-limited minor remark)
  for (const l of all) if (/^x(2|2-9)$/.test(l)) assert.equal(voiceCategory(l), 'minor');
});

/* ---------------- policy ---------------- */

test('levels: Off is silent, Key moments speaks tier, feature and ×10+ callouts, Full speaks everything', () => {
  const p = createVoicePolicy();
  assert.equal(p.level, 'key', 'default level');
  assert.equal(p.check('x100', 0), 'allow');
  assert.equal(p.check('win-big', 0), 'allow');
  assert.equal(p.check('feature-start', 0), 'allow');
  assert.equal(p.check('nice', 0), 'level');
  assert.equal(p.check('laugh', 0), 'level');
  assert.equal(p.check('scatter-tease', 0), 'level');
  assert.equal(p.check('x2-9', 0), 'level', 'the ×2–9 remark is not a Key moment');
  p.setLevel('full');
  for (const l of ['nice', 'scatter-tease', 'x2-9', 'x250', 'win-max', 'feature-end', 'tpl-hilal']) assert.equal(p.check(l, 0), 'allow', l);
  p.setLevel('off');
  for (const l of ['nice', 'x250', 'win-max', 'feature-end']) assert.equal(p.check(l, 0), 'off', l);
  p.setLevel('bogus' as never);
  assert.equal(p.level, 'off', 'an invalid level keeps the current one');
});

test('Tarhun opts in to the ×2–9 remark at Key moments, at most once per 30 s', () => {
  const p = createVoicePolicy({ minorInKey: true });
  assert.equal(p.check('x2-9', 0), 'allow');
  p.commit('x2-9', 0);
  assert.equal(p.check('x2-9', 10), 'repeat');
  assert.equal(p.check('x2-9', 25), 'cooldown', 'past the 20 s repeat window but inside the 30 s minor cooldown');
  assert.equal(p.check('x2-9', MINOR_COOLDOWN + 0.1), 'allow');
  // the default game does not speak it at Key moments
  assert.equal(createVoicePolicy().check('x2-9', 0), 'level');
});

test('at most one line per 2.5 s; tier and feature lines are headlines and are not held back by the gap', () => {
  const p = createVoicePolicy(); p.setLevel('full');
  p.commit('x10', 100);
  assert.equal(p.check('x25', 100 + MIN_GAP - 0.1), 'gap');
  assert.equal(p.check('scatter-tease', 101), 'gap');
  assert.equal(p.check('x25', 100 + MIN_GAP), 'allow');
  assert.equal(p.check('win-big', 101), 'allow', 'tier line right after a callout');
  assert.equal(p.check('feature-trigger', 101), 'allow', 'feature line right after a callout');
});

test('the same line is not repeated within 20 s, except tier lines', () => {
  const p = createVoicePolicy(); p.setLevel('full');
  p.commit('x100', 0); p.commit('win-legend', 0);
  assert.equal(p.check('x100', REPEAT_WINDOW - 0.5), 'repeat');
  assert.equal(p.check('x100', REPEAT_WINDOW), 'allow');
  assert.equal(p.check('win-legend', 1), 'allow', 'max/tier lines may repeat');
  p.commit('retrigger', 50);
  assert.equal(p.check('retrigger', 60), 'repeat', 'a feature line is held to the 20 s rule');
});

test('ambient remarks at most once per 60 s', () => {
  const p = createVoicePolicy(); p.setLevel('full');
  p.commit('nice', 0);
  assert.equal(p.check('laugh', 30), 'cooldown', 'another ambient line shares the 60 s window');
  assert.equal(p.check('nice', 10), 'repeat');
  assert.equal(p.check('nice', 30), 'cooldown');
  assert.equal(p.check('laugh', AMBIENT_COOLDOWN + 1), 'allow');
  assert.equal(p.check('x25', 10), 'allow', 'ambient cooldown does not touch callouts');
});

test('turbo and autoplay: only tier and feature lines', () => {
  const p = createVoicePolicy(); p.setLevel('full'); p.setFast(true);
  for (const l of ['x250', 'x2-9', 'nice', 'laugh', 'scatter-tease', 'lock']) assert.equal(p.check(l, 0), 'fast', l);
  for (const l of ['win-big', 'win-max', 'feature-trigger', 'feature-start', 'retrigger', 'feature-end']) assert.equal(p.check(l, 0), 'allow', l);
  p.setFast(false);
  assert.equal(p.check('x250', 0), 'allow');
});

test('request only commits when the line was really spoken; a clock that restarts never blocks speech', () => {
  const p = createVoicePolicy();
  assert.equal(p.request('x100', 5, () => null), false);
  assert.equal(p.check('x100', 6), 'allow', 'a skipped line does not start the repeat window');
  assert.equal(p.request('x100', 5, () => 'line'), true);
  assert.equal(p.request('x100', 6, () => 'line'), false, 'repeat');
  p.reset();
  assert.equal(p.check('x100', 6), 'allow');
  p.commit('x100', 500);
  assert.equal(p.check('x100', 1), 'allow', 'a new audio context restarts the clock at 0');
});

test('voice level is validated; the hooks pass fast for turbo and autoplay', () => {
  assert.equal(sanitizeVoiceLevel('full'), 'full'); assert.equal(sanitizeVoiceLevel('off'), 'off');
  assert.equal(sanitizeVoiceLevel('loud'), 'key'); assert.equal(sanitizeVoiceLevel(7, 'off'), 'off');
  assert.deepEqual(voicePolicyInput({ voice: 'full', spinSpeed: 'normal' }, false), { level: 'full', fast: false });
  assert.deepEqual(voicePolicyInput({ voice: 'key', spinSpeed: 'turbo' }, false), { level: 'key', fast: true });
  assert.deepEqual(voicePolicyInput({ voice: 'key', spinSpeed: 'quick' }, true), { level: 'key', fast: true });
  assert.deepEqual(voicePolicyInput({}, false), { level: 'key', fast: false });
});

test('the shared slot settings carry the voice level, default Key moments, and reject junk', () => {
  assert.equal(DEFAULT_SLOT_SETTINGS.voice, 'key');
  assert.equal(sanitizeSettings({ voice: 'off' }).voice, 'off');
  assert.equal(sanitizeSettings({ voice: 'shout' }).voice, 'key');
  assert.equal(sanitizeSettings({ voice: 3 }).voice, 'key');
});

/* ---------------- locale ---------------- */

test('voice language: only Turkish speaks Turkish; every other language hears English', () => {
  for (const l of ['tr', 'tr-TR', 'TR', 'tr_TR', ' tr ']) assert.equal(voiceLanguageOf(l), 'tr', l);
  for (const l of ['en', 'de', 'pt', 'pt-BR', 'fr', 'it', 'es', 'zh', 'zh-CN', 'ko', 'trk', '', undefined, null, 5]) assert.equal(voiceLanguageOf(l), 'en', String(l));
  assert.equal(voiceBankFolder('/audio/voice/storm/', 'tr'), '/audio/voice/storm/tr');
  assert.equal(voiceBankFolder('/audio/voice/cascade', 'en'), '/audio/voice/cascade/en');
});

test('voiceLanguage reads <html lang>; the server (no document) is English', () => {
  const scope = globalThis as Record<string, unknown>;
  const real = scope.document;
  try {
    delete scope.document;
    assert.equal(voiceLanguage(), 'en');
    scope.document = { documentElement: { lang: 'tr' } };
    assert.equal(voiceLanguage(), 'tr');
    scope.document = { documentElement: { lang: 'de' } };
    assert.equal(voiceLanguage(), 'en');
    scope.document = { documentElement: { lang: '' } };
    assert.equal(voiceLanguage(), 'en');
  } finally { if (real === undefined) delete scope.document; else scope.document = real; }
});

test('sollish:locale event: listeners hear the voice language, unsubscribe works, a throwing listener is contained', () => {
  const scope = globalThis as Record<string, unknown>;
  const realWindow = scope.window, realDocument = scope.document;
  const win = new EventTarget();
  scope.window = win;
  scope.document = { documentElement: { lang: 'en' } };
  try {
    const heard: string[] = [];
    const off = onVoiceLanguageChange(l => heard.push(l));
    const fire = (locale: unknown) => win.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: { locale } }));
    fire('tr'); fire('de'); fire('tr-TR'); fire('pt');
    assert.deepEqual(heard, ['tr', 'en', 'tr', 'en']);
    // no detail: fall back to <html lang>
    (scope.document as { documentElement: { lang: string } }).documentElement.lang = 'tr';
    win.dispatchEvent(new Event(LOCALE_EVENT));
    assert.equal(heard.at(-1), 'tr');
    const off2 = onVoiceLanguageChange(() => { throw new Error('listener bug'); });
    assert.doesNotThrow(() => fire('en'));
    off2();
    off();
    heard.length = 0; fire('tr');
    assert.deepEqual(heard, [], 'unsubscribed');
    delete scope.window;
    assert.doesNotThrow(() => onVoiceLanguageChange(() => {})(), 'server: no window');
  } finally {
    if (realWindow === undefined) delete scope.window; else scope.window = realWindow;
    if (realDocument === undefined) delete scope.document; else scope.document = realDocument;
  }
});

/* ---------------- the files ---------------- */

test('every voice line exists for both languages (and Candy Cascade has both banks)', () => {
  const root = join(process.cwd(), 'public/audio/voice');
  const banks: Record<string, readonly string[]> = { storm: STORM_VOICE_LINES, ebru: EBRU_VOICE_LINES, cezeri: CEZERI_VOICE_LINES, asena: ASENA_VOICE_LINES, cascade: MULTIPLIER_CLASSES };
  for (const [game, lines] of Object.entries(banks)) {
    for (const lang of ['tr', 'en']) for (const line of lines) assert.ok(existsSync(join(root, game, lang, `${line}.mp3`)), `${game}/${lang}/${line}.mp3`);
    assert.ok(!existsSync(join(root, game, 'x10.mp3')), `${game}: no loose files outside the language folders`);
  }
});
