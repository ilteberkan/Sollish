import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barCount, melody, noteToMidi, parseChord, progression, steps, voice } from '../lib/slot-audio/scores/notation';
import { CASCADE_SCORES } from '../lib/slot-audio/scores/cascade';
import { scoreLength, splitTracks } from '../lib/slot-audio/render';

test('note names and chord symbols', () => {
  assert.equal(noteToMidi('C4'), 60); assert.equal(noteToMidi('A4'), 69); assert.equal(noteToMidi('Bb1'), 34); assert.equal(noteToMidi('F#5'), 78);
  assert.deepEqual(parseChord('Gm7').tones, [7, 10, 2, 5]);
  assert.deepEqual(parseChord('F#dim7').tones, [6, 9, 0, 3]);
  assert.equal(parseChord('Gm7/Bb').bass, 10);
  assert.throws(() => parseChord('Cfoo'));
});

test('melody bars must add up exactly (typos fail loudly)', () => {
  assert.equal(melody('C5:1 D5:1 E5:1 F5:1 | G5:4').length, 5);
  assert.throws(() => melody('C5:1 D5:1 E5:1'), /3 beats/);
  assert.throws(() => melody('C5:1 X5:3'), /bad token/);
  assert.equal(barCount('a | b | c'), 3);
  const p = progression('F | Am7 D7 | Gm7:3 C7:1');
  assert.deepEqual(p.map(c => [c.t, c.d]), [[0, 4], [4, 2], [6, 2], [8, 3], [11, 1]]);
  assert.throws(() => steps('kick', 'x...', 0), /16 steps/);
  const v = voice([5, 9, 0, 4], 4, 53, 72, null);
  assert.equal(v.length, 4); assert.ok(v.every(n => n >= 53 && n <= 72));
});

test('every Candy Cascade score fits its form: whole bars, events inside, loops long enough', () => {
  for (const [key, score] of Object.entries(CASCADE_SCORES)) {
    const beats = score.bars * score.beatsPerBar;
    const { body, total } = scoreLength(score, 44100);
    assert.ok(total > body);
    if (score.loop) {
      if (key === 'base') assert.ok(body / 44100 >= 36 && score.bars >= 16 && score.bars <= 24, 'base loop ≥ 36 s, 16–24 bars');
      if (key === 'feature') assert.ok(body / 44100 >= 30, 'feature loop ≥ 30 s');
    } else assert.ok((score.musicalEnd ?? beats) <= beats, `${key}: musical end inside the score`);
    for (const track of score.tracks) {
      const times = track.kind === 'pitched' ? track.notes.map(n => n.t) : track.kind === 'pad' ? track.chords.map(c => c.t) : track.kind === 'kit' ? track.hits.map(h => h.t) : track.fx.map(f => f.t);
      for (const t of times) assert.ok(t >= 0 && t < beats, `${key}/${track.id} event at beat ${t} outside 0..${beats}`);
      if (track.kind === 'pitched') for (const n of track.notes) assert.ok(n.n + (track.transpose ?? 0) >= 24 && n.n + (track.transpose ?? 0) <= 110, `${key}/${track.id} pitch`);
    }
  }
  // tempos and keys from the brief
  assert.equal(CASCADE_SCORES.base.bpm, 104); assert.equal(CASCADE_SCORES.feature.bpm, 118);
  // stinger lengths: fanfare ≈ 3 s to its musical end, outro ≈ 4–5 s, big wins 3–6 s
  const end = (k: keyof typeof CASCADE_SCORES) => ((CASCADE_SCORES[k].musicalEnd ?? 0) * 60) / CASCADE_SCORES[k].bpm;
  assert.ok(Math.abs(end('fsIntro') - 3) < 0.2);
  assert.ok(end('fsOutro') >= 4 && end('fsOutro') <= 5);
  for (const k of ['bigWin1', 'bigWin2', 'bigWin3', 'maxWin'] as const) assert.ok(end(k) >= 3 && end(k) <= 6, k);
});

test('tracks split over workers cover every track exactly once', () => {
  for (const score of Object.values(CASCADE_SCORES)) for (const bins of [1, 2, 3, 4]) {
    const groups = splitTracks(score, bins);
    assert.ok(groups.length <= bins);
    assert.deepEqual(groups.flat().sort(), score.tracks.map(t => t.id).sort());
  }
});
