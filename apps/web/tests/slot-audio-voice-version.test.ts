import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VOICE_FOLDER_VERSIONS } from '../lib/slot-audio/voice-version.generated';
import { versionedVoiceUrl } from '../lib/slot-audio/voice-version';
import { voiceBankFolder } from '../lib/slot-audio/voice-locale';
import { ASENA_VOICE_LINES, asenaVoiceBankUrls } from '../lib/slot-audio/asena-tiers';
import { CEZERI_VOICE_LINES, cezeriVoiceBankUrls } from '../lib/slot-audio/cezeri-tiers';
import { EBRU_VOICE_LINES, ebruVoiceBankUrls } from '../lib/slot-audio/ebru-tiers';
import { STORM_VOICE_LINES, stormVoiceBankUrls } from '../lib/slot-audio/storm-tiers';
import { MULTIPLIER_CLASSES, voiceBankUrls } from '../lib/slot-audio/win-tiers';

const root = join(process.cwd(), 'public/audio/voice');
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

test('generated voice versions cover every game/language folder and hash its files (any change moves the URL)', () => {
  const expected: Record<string, string> = {};
  for (const game of readdirSync(root).sort()) for (const lang of readdirSync(join(root, game)).sort()) {
    const dir = join(root, game, lang), files = readdirSync(dir).filter(f => f.endsWith('.mp3')).sort();
    expected[`/audio/voice/${game}/${lang}`] = sha(files.map(f => `${f}:${sha(readFileSync(join(dir, f)))}`).join('\n')).slice(0, 12);
  }
  assert.deepEqual(VOICE_FOLDER_VERSIONS, expected, 'run `node scripts/build-audio-worker.mjs`: voice files changed since the last generation');
  assert.equal(Object.keys(expected).length, 12);
  assert.equal(new Set(Object.values(expected)).size, 12, 'folders with different bytes have different versions');
});

test('versionedVoiceUrl: known folder gets ?v=<hash>, anything else is left alone', () => {
  const url = '/audio/voice/ebru/tr/x10.mp3';
  assert.equal(versionedVoiceUrl(url), `${url}?v=${VOICE_FOLDER_VERSIONS['/audio/voice/ebru/tr']}`);
  assert.match(versionedVoiceUrl(url), /\?v=[0-9a-f]{12}$/);
  for (const other of ['/audio/voice/ebru/x10.mp3', '/audio/voice/ebru/fr/x10.mp3', 'https://cdn.example/x.mp3', 'x.mp3', '/audio/voice/__proto__/tr/x.mp3', '']) assert.equal(versionedVoiceUrl(other), other);
  assert.equal(versionedVoiceUrl('/audio/voice/constructor/x.mp3'), '/audio/voice/constructor/x.mp3');
});

test('all five voice bank loaders request versioned URLs for both languages; per-line custom URLs stay as given', () => {
  const banks = [
    ['cascade', MULTIPLIER_CLASSES, (f: string) => voiceBankUrls(f)],
    ['storm', STORM_VOICE_LINES, (f: string) => stormVoiceBankUrls(f)],
    ['ebru', EBRU_VOICE_LINES, (f: string) => ebruVoiceBankUrls(f)],
    ['cezeri', CEZERI_VOICE_LINES, (f: string) => cezeriVoiceBankUrls(f)],
    ['asena', ASENA_VOICE_LINES, (f: string) => asenaVoiceBankUrls(f)],
  ] as const;
  for (const [game, lines, build] of banks) for (const lang of ['tr', 'en'] as const) {
    const folder = voiceBankFolder(`/audio/voice/${game}`, lang), version = VOICE_FOLDER_VERSIONS[folder];
    assert.match(version ?? '', /^[0-9a-f]{12}$/, folder);
    const urls = build(folder) as Record<string, string | null>;
    for (const line of lines) assert.equal(urls[line], `${folder}/${line}.mp3?v=${version}`);
  }
  assert.equal(stormVoiceBankUrls({ x10: '/custom/x10.mp3' }).x10, '/custom/x10.mp3');
});

test('public/_headers: voice lines are immutable, no broader /audio/* rule joins a second Cache-Control', () => {
  const headers = readFileSync(join(process.cwd(), 'public/_headers'), 'utf8');
  const block = (path: string) => headers.split('\n').reduce<string[] | null>((found, line, i, all) => (line.trim() === path ? all.slice(i + 1, i + 3).filter(l => /^\s+\S/.test(l)).map(l => l.trim()) : found), null);
  assert.deepEqual(block('/audio/voice/*'), ['Cache-Control: public, max-age=31536000, immutable']);
  assert.equal(block('/audio/*'), null);
  assert.deepEqual(block('/audio/ringside/*'), ['Cache-Control: public, max-age=3600, stale-while-revalidate=86400']);
});
