import type { SparringEvent } from '@sollish/protocol';

/**
 * Presentation-only arena sound. Driven by already-resolved engine events; it never feeds back
 * into the fight. Sources and licences: public/audio/ringside/credits.json.
 */
const BASE = '/audio/ringside/';
const FILES = ['punch-01', 'punch-02', 'punch-03', 'punch-04', 'punch-05', 'crowd-ambience', 'crowd-cheer', 'crowd-react', 'bell'] as const;
type Name = typeof FILES[number];

export type RingsideAudio = {
  /** Call from a user gesture; browsers keep audio suspended until then. */
  resume: () => Promise<void>;
  setEnabled: (on: boolean) => void;
  bell: (strikes?: number) => void;
  events: (events: readonly SparringEvent[], tick: number) => void;
  /** 0..1 excitement from the fight state (health loss, close range, combos). */
  setIntensity: (value: number) => void;
  dispose: () => void;
};

export async function loadRingsideAudio(signal: AbortSignal): Promise<RingsideAudio> {
  const context = new AudioContext({ latencyHint: 'interactive' });
  const master = context.createGain(); master.gain.value = 0; master.connect(context.destination);
  const compressor = context.createDynamicsCompressor(); compressor.threshold.value = -14; compressor.ratio.value = 4; compressor.connect(master);
  const crowdBus = context.createGain(); crowdBus.gain.value = .32; crowdBus.connect(compressor);
  const fxBus = context.createGain(); fxBus.gain.value = .9; fxBus.connect(compressor);
  const buffers = new Map<Name, AudioBuffer>();
  try {
    await Promise.all(FILES.map(async name => {
      const response = await fetch(BASE + name + '.mp3', { signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error('Audio asset unavailable');
      buffers.set(name, await context.decodeAudioData(await response.arrayBuffer()));
    }));
  } catch (error) { void context.close(); throw error; }
  let enabled = false, disposed = false, ambience: AudioBufferSourceNode | null = null, lastReact = -1e9, intensity = 0;
  const startAmbience = () => {
    if (ambience || disposed) return;
    const source = context.createBufferSource(); source.buffer = buffers.get('crowd-ambience')!; source.loop = true;
    // Skip MP3 encoder padding at the seam.
    source.loopStart = .06; source.loopEnd = source.buffer.duration - .06;
    source.connect(crowdBus); source.start(context.currentTime + .05, .06); ambience = source;
  };
  const play = (name: Name, { gain = 1, rate = 1, bus = fxBus, lowpass = 0, pan = 0, at = 0 } = {}) => {
    if (!enabled || disposed || context.state !== 'running') return;
    const source = context.createBufferSource(); source.buffer = buffers.get(name)!; source.playbackRate.value = rate;
    const amp = context.createGain(); amp.gain.value = gain;
    let node: AudioNode = source;
    if (lowpass > 0) { const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = lowpass; node.connect(filter); node = filter; }
    const panner = context.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(amp); amp.connect(panner); panner.connect(bus);
    source.start(context.currentTime + at);
    source.onended = () => { source.disconnect(); amp.disconnect(); panner.disconnect(); };
  };
  const whoosh = (pan: number) => {
    if (!enabled || disposed || context.state !== 'running') return;
    // Short band-passed noise sweep for a thrown punch: synthesized, no sample.
    const length = Math.floor(context.sampleRate * .16), buffer = context.createBuffer(1, length, context.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / length) ** 2;
    const source = context.createBufferSource(); source.buffer = buffer;
    const band = context.createBiquadFilter(); band.type = 'bandpass'; band.Q.value = 1.4;
    band.frequency.setValueAtTime(700, context.currentTime); band.frequency.exponentialRampToValueAtTime(2400, context.currentTime + .14);
    const amp = context.createGain(); amp.gain.value = .11; const panner = context.createStereoPanner(); panner.pan.value = pan;
    source.connect(band); band.connect(amp); amp.connect(panner); panner.connect(fxBus); source.start();
    source.onended = () => { source.disconnect(); band.disconnect(); amp.disconnect(); panner.disconnect(); };
  };
  const pick = (seed: number) => (['punch-01', 'punch-02', 'punch-03', 'punch-04', 'punch-05'] as const)[seed % 5]!;
  return {
    resume: async () => { if (context.state === 'suspended') await context.resume(); startAmbience(); },
    setEnabled: on => { enabled = on; master.gain.setTargetAtTime(on ? .85 : 0, context.currentTime, .08); if (on) startAmbience(); },
    bell: (strikes = 1) => { for (let i = 0; i < strikes; i++) play('bell', { gain: .55, at: i * .32 }); },
    setIntensity: value => {
      intensity = Math.max(0, Math.min(1, value));
      crowdBus.gain.setTargetAtTime(.22 + .3 * intensity, context.currentTime, .6);
    },
    events: (events, tick) => {
      for (const event of events) {
        const pan = event.point ? Math.max(-.7, Math.min(.7, event.point.x / 3)) : 0;
        if (event.type === 'attack') whoosh(pan);
        else if (event.type === 'hit') {
          const heavy = event.damage >= 50;
          play(pick(event.id), { gain: heavy ? 1 : .75, rate: heavy ? .86 : 1.02, pan });
          if (heavy && tick - lastReact > 90) { play('crowd-react', { gain: .5 + .4 * intensity, bus: crowdBus }); lastReact = tick; }
        } else if (event.type === 'block') play(pick(event.id + 2), { gain: .45, rate: 1.35, lowpass: 1800, pan });
        else if (event.type === 'counter' && tick - lastReact > 60) { play('crowd-react', { gain: .6, bus: crowdBus, rate: 1.05 }); lastReact = tick; }
        else if (event.type === 'guardbreak') play(pick(event.id), { gain: .8, rate: .74, pan });
        else if (event.type === 'knockout' || event.type === 'decision') { play('crowd-cheer', { gain: 1, bus: crowdBus }); }
        else if (event.type === 'knockdown') { play('crowd-react', { gain: 1, bus: crowdBus, rate: .92 }); play('crowd-cheer', { gain: .55, bus: crowdBus, at: .25 }); lastReact = tick; }
        else if (event.type === 'roundstart') play('bell', { gain: .55 });
        else if (event.type === 'roundend') { for (let i = 0; i < 3; i++) play('bell', { gain: .55, at: i * .32 }); }
      }
    },
    dispose: () => { if (disposed) return; disposed = true; try { ambience?.stop(); } catch { /* already stopped */ } void context.close(); },
  };
}
