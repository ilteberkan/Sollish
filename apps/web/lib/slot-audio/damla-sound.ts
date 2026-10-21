/**
 * Damla: Pamukkale runtime sound engine (Web Audio). Presentation only: it is told what happened and never reads or
 * changes a result. Buffers are synthesized in the browser from sfx/damla.ts after the first user gesture (short effects
 * first, then the two 32 s loops while the page is idle). Buses: music, sfx and ambience gains into a master gain and a
 * gentle limiter; the mix follows the slot settings, a hidden tab is silent, the gold signature ducks the beds.
 */
import type { VoiceCtx } from './synth/instruments';
import type { Stereo } from './synth/dsp';
import { createYielder } from './synth/dsp';
import { DAMLA_PLINK_STEPS, damlaRng, renderAmbience, renderChime, renderClick, renderDenied, renderGoldStinger, renderMusic, renderPlink, renderSplash } from './sfx/damla';
import { midiToHz } from './timing';

type Mix = { master: number; music: number; sfx: number; ambience: number; muted: boolean };
type Progress = { done: number; total: number };
const PLINK_BASE = 74; // D5
const MAX_PLINKS = 18;

export function createDamlaSound() {
  const AC: typeof AudioContext | undefined = typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!AC) return null;
  const ac = new AC({ latencyHint: 'interactive' });
  const master = ac.createGain(), limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.2;
  master.connect(limiter).connect(ac.destination);
  const bus = { music: ac.createGain(), sfx: ac.createGain(), ambience: ac.createGain() };
  const duckGain = ac.createGain();
  bus.music.connect(duckGain); bus.ambience.connect(duckGain); duckGain.connect(master); bus.sfx.connect(master);
  let mix: Mix = { master: 0.9, music: 0.6, sfx: 0.8, ambience: 0.4, muted: true };
  let enabled = false, scene: 'idle' | 'base' | 'none' = 'idle', disposed = false;
  const buf: Record<string, AudioBuffer | AudioBuffer[]> = {};
  let loops: { music?: AudioBufferSourceNode; ambience?: AudioBufferSourceNode } = {};
  let loading: Promise<void> | null = null;
  let activePlinks = 0;
  const rng = damlaRng(0x0da31a);

  const toBuffer = (st: Stereo | Float32Array): AudioBuffer => {
    const isMono = st instanceof Float32Array;
    const length = isMono ? st.length : st.l.length;
    const b = ac.createBuffer(2, Math.max(1, length), ac.sampleRate);
    if (isMono) { b.copyToChannel(st as Float32Array<ArrayBuffer>, 0); b.copyToChannel(st as Float32Array<ArrayBuffer>, 1); }
    else { b.copyToChannel(st.l as Float32Array<ArrayBuffer>, 0); b.copyToChannel(st.r as Float32Array<ArrayBuffer>, 1); }
    return b;
  };
  const applyMix = () => {
    const now = ac.currentTime, on = enabled && !mix.muted;
    master.gain.setTargetAtTime(on ? mix.master : 0, now, 0.05);
    bus.music.gain.setTargetAtTime(mix.music * 0.55, now, 0.05);
    bus.sfx.gain.setTargetAtTime(mix.sfx, now, 0.05);
    bus.ambience.gain.setTargetAtTime(mix.ambience * 0.9, now, 0.05);
  };
  const startLoops = () => {
    if (scene !== 'base' || disposed) return;
    for (const name of ['music', 'ambience'] as const) {
      const b = buf[name];
      if (!(b instanceof AudioBuffer) || loops[name]) continue;
      const src = ac.createBufferSource();
      src.buffer = b; src.loop = true;
      const fade = ac.createGain(); fade.gain.value = 0; fade.gain.setTargetAtTime(1, ac.currentTime, 0.8);
      src.connect(fade).connect(bus[name]);
      src.start();
      loops[name] = src;
    }
  };
  const stopLoops = () => { for (const src of Object.values(loops)) { try { src?.stop(); } catch { /* already stopped */ } } loops = {}; };
  const play = (b: AudioBuffer | undefined, opts: { rate?: number; gain?: number; pan?: number; when?: number; target?: GainNode } = {}) => {
    if (!b || disposed || !enabled || mix.muted) return null;
    const src = ac.createBufferSource();
    src.buffer = b; src.playbackRate.value = opts.rate ?? 1;
    const g = ac.createGain(); g.gain.value = opts.gain ?? 1;
    let node: AudioNode = src.connect(g);
    if (opts.pan && typeof ac.createStereoPanner === 'function') { const p = ac.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, opts.pan)); node = node.connect(p); }
    node.connect(opts.target ?? bus.sfx);
    src.start(ac.currentTime + (opts.when ?? 0));
    return src;
  };
  const pick = (name: string) => { const v = buf[name]; return Array.isArray(v) ? v[Math.floor(rng() * v.length)] : v; };

  async function render(onProgress?: (p: Progress) => void) {
    const sr = ac.sampleRate, ctx: VoiceCtx = { sr, rng: damlaRng(7) };
    const yieldNow = createYielder(6);
    const total = 6;
    let done = 0;
    const step = async () => { done++; onProgress?.({ done, total }); await yieldNow(); };
    buf.plink = [0, 1, 2, 3].map(v => toBuffer(renderPlink(ctx, midiToHz(PLINK_BASE), 0.9, v)));
    buf.splash = toBuffer(renderSplash(ctx, 0.7));
    buf.click = toBuffer(renderClick(ctx, true)); buf.clickDown = toBuffer(renderClick(ctx, false)); buf.denied = toBuffer(renderDenied(ctx));
    await step();
    buf.chime = [0, 1, 2, 3, 4, 5].map(t => toBuffer(renderChime(ctx, t)));
    await step();
    buf.gold = toBuffer(renderGoldStinger(ctx));
    await step();
    buf.ambience = toBuffer(await renderAmbience(ctx, undefined, yieldNow));
    await step();
    startLoops();
    buf.music = toBuffer(await renderMusic(ctx, undefined, yieldNow));
    await step();
    startLoops();
    await step();
  }

  return {
    resume: () => { if (ac.state === 'suspended') void ac.resume().catch(() => undefined); },
    load: (onProgress?: (p: Progress) => void) => { loading ??= render(onProgress).catch(() => undefined); return loading; },
    setMix: (next: Mix) => { mix = next; applyMix(); },
    setEnabled: (on: boolean) => { enabled = on; applyMix(); },
    setScene: (next: 'idle' | 'base' | 'none') => { scene = next; if (next === 'base') startLoops(); else if (next === 'none') stopLoops(); },
    /** One plink per terrace splash: pitch falls along the pentatonic as the drop descends, with a random neighbour step. */
    plink: (terrace: number, rows: number) => {
      if (activePlinks >= MAX_PLINKS) return;
      const ladder = DAMLA_PLINK_STEPS, pos = 1 - terrace / Math.max(1, rows - 1);
      const idx = Math.max(0, Math.min(ladder.length - 1, Math.round(pos * (ladder.length - 1)) + (rng() < 0.3 ? (rng() < 0.5 ? -1 : 1) : 0)));
      const rate = 2 ** ((ladder[idx]! - 7) / 12) * (1 + (rng() - 0.5) * 0.01);
      const src = play(pick('plink'), { rate, gain: 0.28 + rng() * 0.12, pan: (rng() - 0.5) * 0.5 });
      if (src) { activePlinks++; src.onended = () => { activePlinks--; }; }
    },
    land: (tier: number, edge: boolean) => {
      play(buf.splash as AudioBuffer, { gain: 0.25 + tier * 0.05 });
      const chimes = buf.chime as AudioBuffer[] | undefined;
      play(chimes?.[Math.max(0, Math.min(5, tier))], { gain: edge ? 0.8 : 0.6 });
    },
    gold: () => {
      const now = ac.currentTime;
      duckGain.gain.cancelScheduledValues(now);
      duckGain.gain.setTargetAtTime(0.25, now, 0.05);
      duckGain.gain.setTargetAtTime(1, now + 3.2, 0.6);
      play(buf.gold as AudioBuffer, { gain: 0.9 });
    },
    click: () => play(buf.click as AudioBuffer, { gain: 0.35 }),
    betChange: (direction: 1 | -1) => play((direction > 0 ? buf.click : buf.clickDown) as AudioBuffer, { gain: 0.35 }),
    denied: () => play(buf.denied as AudioBuffer, { gain: 0.5 }),
    dispose: () => { disposed = true; stopLoops(); void ac.close().catch(() => undefined); },
  };
}
export type DamlaSoundEngine = NonNullable<ReturnType<typeof createDamlaSound>>;
