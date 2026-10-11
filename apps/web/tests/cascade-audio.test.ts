import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCascadeAudio } from '../lib/cascade-audio';

test('cascade audio is a safe no-op when Web Audio is unavailable', async () => {
  const scope = globalThis as Record<string, unknown>;
  assert.equal(typeof scope.AudioContext, 'undefined');
  const audio = createCascadeAudio();
  await audio.resume(); audio.setEnabled(true);
  audio.spinStart(); audio.land(3); audio.pop(12, 2); audio.win(25); audio.crystal(10); audio.collect(); audio.scatter(4); audio.freeSpinsIntro();
  for (const tier of [1, 2, 3] as const) audio.bigWin(tier);
  audio.setEnabled(false); audio.dispose(); audio.dispose();
});

test('cascade audio stays silent until enabled and after dispose, even with a context', async () => {
  const created: string[] = [];
  class FakeContext {
    state = 'running'; currentTime = 0; sampleRate = 8000; destination = {};
    constructor() { created.push('ctx'); }
    createGain() { return { gain: { value: 0, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    createDynamicsCompressor() { return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {}, disconnect() {} }; }
    createBuffer(_c: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
    createOscillator() { created.push('osc'); return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} }; }
    createBufferSource() { created.push('src'); return { connect() {}, disconnect() {}, start() {}, stop() {} }; }
    createBiquadFilter() { return { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: {}, connect() {}, disconnect() {} }; }
    createStereoPanner() { return { pan: {}, connect() {}, disconnect() {} }; }
    async resume() {} async close() {}
  }
  const scope = globalThis as Record<string, unknown>;
  scope.AudioContext = FakeContext;
  try {
    const audio = createCascadeAudio();
    audio.pop(10, 1); assert.equal(created.length, 0, 'default disabled: no nodes, no context');
    audio.setEnabled(true); audio.pop(10, 1); audio.land(2); audio.win(10);
    assert.ok(created.includes('osc') && created.includes('src'), 'enabled: sound is scheduled');
    audio.dispose(); const count = created.length; audio.pop(10, 1); assert.equal(created.length, count, 'disposed: silent');
  } finally { delete scope.AudioContext; }
});
