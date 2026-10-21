/**
 * Offline renderer: score → instrument stems (JS synthesis, cooperative and seeded) → mixdown with a
 * generated convolution reverb on a send (OfflineAudioContext when available) → loop folding → master
 * EQ, loudness normalisation and look-ahead limiting. Runtime playback is then plain buffer playback.
 */
import { Biquad, addMono, addStereo, addStereoUpsampled, fadeEdges, softClip, stereo, upsample, type Stereo } from './synth/dsp';
import {
  bass, bell, brush, celesta, choirChord, roomTone, clap, crash, glock, hat, impact, kick, marimba, musicBox, padChord, pluck, riser, shaker, snap, snare,
  sparkles, synthLead, timpani, tom, whoosh, wood, type PadKind, type VoiceCtx,
} from './synth/instruments';
import { baglama, bronze, darbuka, davul, davulRim, frameDrum, horn, hornChord, ney, rain, taiko, thunderCrack, thunderRumble, wind, zurna } from './synth/anatolian';
import { bubbles, glassHarpFast, kanun, kudum, ud, waterBed, waterGlassFast, zil } from './synth/ebru';
import { chimeRod, courtyard, drip, escapement, gearClank, gearWhirr, handCymbal, kos, naqqara, pipeFast, pour, ratchet, santur } from './synth/cezeri';
import { KARGYRAA_HARMONICS, anvil, auroraChord, fireCrackle, hoof, kamDavul, khoomeiFast, kilKopuzFast, kopuz, starBell, steppeNight } from './synth/asena';
import { burnerRoar, dawnValley } from './synth/goreme';
import { foldLoop, loudness, master } from './synth/master';
import { HALL, ROOM, makeImpulse, type ImpulseSpec } from './synth/reverb';
import type { Score, KitHit, PitchedVoice, Track } from './scores/types';
import type { SfxDef } from './sfx/cascade';
import { SFX_LEVELS } from './sfx/cascade';
import { ASSET_CEILING_DB, Cancelled, REVERB_DECIMATION, reverbWet, sfxTail, type RenderEnv, type RenderedAsset, type SfxClip, type SfxPart, type SfxSynth, type StemSum } from './render-shared';
import { beatToSeconds, createRng, dbToGain, hashSeed, loopLengthSamples, midiToHz, swingBeat } from './timing';

export * from './render-shared';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function impulse(env: RenderEnv, name: 'hall' | 'room'): Promise<Stereo> {
  let p = env.impulses.get(name);
  if (!p) {
    const spec: ImpulseSpec = name === 'hall' ? HALL : ROOM;
    p = makeImpulse(env.sampleRate / REVERB_DECIMATION, spec, createRng(hashSeed(`ir-${name}`)));
    env.impulses.set(name, p);
  }
  return p;
}

/* ---------------- voices ---------------- */

function pitched(ctx: VoiceCtx, voice: PitchedVoice, freq: number, vel: number, held: number, bright: number): Float32Array {
  switch (voice) {
    case 'celesta': return celesta(ctx, freq, vel, held, bright);
    case 'musicBox': return musicBox(ctx, freq, vel);
    case 'glock': return glock(ctx, freq, vel);
    case 'marimba': return marimba(ctx, freq, vel, held);
    case 'pluck': return pluck(ctx, freq, vel, held, bright, 1.0, 0.35);
    case 'synthLead': return synthLead(ctx, freq, vel, held, 1500 + 900 * bright, 2600 * bright);
    // bass is band-limited (< 2 kHz), so it is synthesised at a quarter rate and interpolated up
    case 'bass': return upsample(bass({ sr: ctx.sr / 4, rng: ctx.rng }, freq, vel, held, 1.6, 850), 4);
    case 'bassDrive': return upsample(bass({ sr: ctx.sr / 4, rng: ctx.rng }, freq, vel, held, 2.6, 1100, 0.22), 4);
    case 'bell': return bell(ctx, freq, vel);
    case 'timpani': return timpani(ctx, vel, freq);
    // brass-like stab: the synth lead with a darker, slower-opening filter and a longer body
    case 'brass': return synthLead(ctx, freq, vel, held, 700 + 500 * bright, 1900 * bright, 0.32);
    // Tarhun voices (synth/anatolian.ts)
    case 'zurna': return zurna(ctx, freq, vel, held, bright);
    case 'zurnaSoft': return zurna(ctx, freq, vel, held, bright, { mellow: true, scoop: 0.02, vibrato: 0.7 });
    case 'ney': return ney(ctx, freq, vel, held);
    case 'baglama': return baglama(ctx, freq, vel, held, 0.55 + 0.3 * bright);
    case 'horn': return horn(ctx, freq, vel, held, { attack: 0.04, bright });
    case 'hornSwell': return horn(ctx, freq, vel, held, { attack: Math.min(0.9, Math.max(0.12, held * 0.55)), bright });
    case 'bronze': return bronze(ctx, freq, vel, bright);
    case 'taikoPitched': return taiko(ctx, vel, freq);
    // Ebru voices (synth/ebru.ts)
    case 'kanun': return kanun(ctx, freq, vel, held, bright);
    case 'kanunSoft': return kanun(ctx, freq, vel * 0.85, held, bright * 0.55, { ring: 0.2, courses: 2 });
    case 'ud': return ud(ctx, freq, vel, held, 0.5 + 0.3 * bright);
    case 'glassHarp': return glassHarpFast(ctx, freq, vel, held);
    case 'waterGlass': return waterGlassFast(ctx, freq, vel, 1, bright);
    // Cezeri voices (synth/cezeri.ts)
    case 'santur': return santur(ctx, freq, vel, held, bright);
    case 'santurSoft': return santur(ctx, freq, vel * 0.85, held, bright * 0.55, { courses: 2, ring: 0.45 });
    case 'pipe': return pipeFast(ctx, freq, vel, held, { rank: 'flute', chiff: bright });
    case 'waterOrgan': return pipeFast(ctx, freq, vel, held, { rank: 'organ', chiff: bright });
    case 'chimeRod': return chimeRod(ctx, freq, vel, bright);
    case 'drip': return drip(ctx, freq, vel, bright);
    // Asena voices (synth/asena.ts)
    case 'kopuz': return kopuz(ctx, freq, vel, held, bright, { drone: -5 });
    case 'kopuzMute': return kopuz(ctx, freq, vel, held, bright, { mute: true, drone: -5 });
    case 'kilKopuz': return kilKopuzFast(ctx, freq, vel, held, bright);
    case 'khoomei': return khoomeiFast(ctx, freq, vel, held, { whistle: bright });
    case 'kargyraa': return khoomeiFast(ctx, freq, vel, held, { harmonics: KARGYRAA_HARMONICS, growl: 0.8, whistle: 0.7 * bright });
    case 'starBell': return starBell(ctx, freq, vel, bright);
    // Göreme voice: the bağlama with its sympathetic strings tuned to F (F2 C3 F3)
    case 'dawnSaz': return baglama(ctx, freq, vel, held, 0.5 + 0.3 * bright, { drones: [87.31, 130.81, 174.61], sympathy: 0.12 });
  }
}

const KIT_PAN: Partial<Record<KitHit, number>> = { hat: -0.25, hatOpen: -0.3, shaker: 0.3, wood: 0.35, woodHi: -0.35, snap: 0.15, tomHi: 0.3, tomLo: -0.3, brush: 0.05, davulRim: 0.25, tek: -0.3, ka: -0.38, dum: -0.2, frame: 0.3, kudumDum: -0.22, kudumTek: 0.22, zil: 0.4, frameLo: 0.15,
  kamTek: 0.2, kamJingle: -0.3, hoof: -0.12, anvil: 0.32,
  escTick: 0.32, escTock: -0.32, ratchet: 0.2, naqDum: -0.25, naqTek: 0.25, cymbal: 0.35, cymbalSoft: -0.35, clank: -0.1 };

function kit(ctx: VoiceCtx, k: KitHit, v: number): Float32Array | Stereo {
  switch (k) {
    case 'kick': return kick(ctx, v, 128, 48, 0.034, 0.42, 0.35, 1.25);
    case 'kickSoft': return kick(ctx, v, 112, 50, 0.03, 0.3, 0.15, 1.1);
    case 'kickPunch': return kick(ctx, v, 158, 46, 0.045, 0.5, 0.6, 1.7);
    case 'brush': return brush(ctx, v);
    case 'snare': return snare(ctx, v);
    case 'clap': return clap(ctx, v);
    case 'hat': return hat(ctx, v);
    case 'hatOpen': return hat(ctx, v, true);
    case 'shaker': return shaker(ctx, v);
    case 'snap': return snap(ctx, v);
    case 'wood': return wood(ctx, v, 1);
    case 'woodHi': return wood(ctx, v, 1.335);
    case 'tomHi': return tom(ctx, v, 220);
    case 'tomMid': return tom(ctx, v, 165);
    case 'tomLo': return tom(ctx, v, 110);
    case 'timp': return timpani(ctx, v, 87.31);
    case 'timpLo': return timpani(ctx, v, 65.41);
    case 'crash': return crash(ctx, v);
    case 'davul': return davul(ctx, v, 58);
    case 'davulLo': return davul(ctx, v, 49, 1.1);
    case 'davulRim': return davulRim(ctx, v);
    case 'dum': return darbuka(ctx, v, 'dum');
    case 'tek': return darbuka(ctx, v, 'tek');
    case 'ka': return darbuka(ctx, v, 'ka');
    case 'frame': return frameDrum(ctx, v);
    case 'taiko': return taiko(ctx, v, 50);
    case 'taikoLo': return taiko(ctx, v, 41);
    case 'kudumDum': return kudum(ctx, v, 'dum');
    case 'kudumTek': return kudum(ctx, v, 'tek');
    case 'zil': return zil(ctx, v);
    case 'frameLo': return frameDrum(ctx, v, 92);
    case 'escTick': return escapement(ctx, v, 'tick');
    case 'escTock': return escapement(ctx, v, 'tock');
    case 'ratchet': return ratchet(ctx, v);
    case 'clank': return gearClank(ctx, v, 1, false);
    case 'naqDum': return naqqara(ctx, v, 'dum');
    case 'naqTek': return naqqara(ctx, v, 'tek');
    case 'kos': return kos(ctx, v);
    case 'kosLo': return kos(ctx, v, 49);
    case 'cymbal': return handCymbal(ctx, v);
    case 'cymbalSoft': return handCymbal(ctx, v * 0.7, 0.45, 540);
    case 'kamDum': return kamDavul(ctx, v, 'dum');
    case 'kamTek': return kamDavul(ctx, v, 'tek');
    case 'kamJingle': return kamDavul(ctx, v, 'jingle');
    case 'hoof': return hoof(ctx, v);
    case 'anvil': return anvil(ctx, v);
  }
}

const isStereo = (x: Float32Array | Stereo): x is Stereo => !(x instanceof Float32Array);

/** Beat-locked sidechain-style gain: quick dip on each beat, smooth recovery over half a beat. */
export function pumpGain(phase: number, depth: number): number {
  const a = 0.04, r = 0.5;
  if (phase < a) return 1 - depth * (phase / a);
  const x = (phase - a) / r;
  return x >= 1 ? 1 : 1 - depth * (1 - x) * (1 - x);
}

function applyPump(st: Stereo, sampleRate: number, bpm: number, depth: number, lo = 0, hi = st.l.length) {
  const beat = (60 / bpm) * sampleRate;
  for (let i = lo; i < hi; i++) { const g = pumpGain((i % beat) / beat, depth); st.l[i]! *= g; st.r[i]! *= g; }
}

/* ---------------- score rendering ---------------- */

/** Renders one track into `st` (which must be silent) and returns the sample range it touched. */
async function renderTrack(score: Score, track: Track, st: Stereo, env: RenderEnv): Promise<{ lo: number; hi: number }> {
  const sr = env.sampleRate, total = st.l.length, { body } = scoreLength(score, sr);
  let lo = total, hi = 0;
  const mark = (at: number, length: number) => { lo = Math.max(0, Math.min(lo, at)); hi = Math.min(total, Math.max(hi, at + length)); };
  // a note pushed before 0 by humanising wraps to the end of a loop (the fold brings its tail back to the
  // start), so nothing is ever cut mid-waveform at the seam; one-shots just start at 0
  const place = (at: number) => (at >= 0 ? at : score.loop ? at + body : 0);
  const putMono = (buf: Float32Array, at: number, gain: number, p: number) => { const a = place(at); addMono(st, buf, a, gain, p); mark(a, buf.length); };
  const putStereo = (buf: Stereo, at: number, gain: number, p: number, w = 1) => { const a = place(at); addStereo(st, buf, a, gain, p, w); mark(a, buf.l.length); };
  const ctx: VoiceCtx = { sr, rng: createRng(hashSeed(`${score.id}/${track.id}`)) };
  const jitterRng = createRng(hashSeed(`${score.id}/${track.id}/humanize`));
  const swingOn = track.swing !== false;
  const at = (beat: number) => beatToSeconds(swingOn ? swingBeat(beat, score.swing) : beat, score.bpm);
  const human = (ms: number) => Math.round(((jitterRng() * 2 - 1) * ms * sr) / 1000);
  const cache = new Map<string, (Float32Array | Stereo)[]>();
  const cached = <T extends Float32Array | Stereo>(key: string, variants: number, make: () => T): T => {
    let list = cache.get(key);
    if (!list) { list = []; cache.set(key, list); }
    if (list.length < variants) { const made = make(); list.push(made); return made; }
    return list[Math.floor(ctx.rng() * list.length)] as T;
  };
  const pan = track.pan ?? 0;
  const check = async () => { if (env.cancelled?.()) throw new Cancelled(); await env.tick(); };

  if (track.kind === 'pitched') {
    for (const n of track.notes) {
      const start = at(n.t), held = Math.max(0.03, at(n.t + n.d) - start);
      const vel = Math.max(0.05, Math.min(1, n.v * (1 + (jitterRng() * 2 - 1) * 0.05)));
      const midi = n.n + (track.transpose ?? 0);
      const key = `${midi}|${Math.round(vel * 20)}|${Math.round(held * 32)}`;
      const buf = cached(key, 2, () => pitched(ctx, track.voice, midiToHz(midi), Math.round(vel * 20) / 20, Math.round(held * 32) / 32, track.bright ?? 1));
      putMono(buf, Math.round(start * sr) + human(track.humanize ?? 3), vel ** 0.4, pan);
      await check();
    }
  } else if (track.kind === 'pad') {
    const male = track.voice === 'padChoirMale', hornPad = track.voice === 'padHorn';
    const choir = track.voice === 'padChoir', aurora = track.voice === 'padAurora';
    const kind: PadKind = track.voice === 'padSaw' ? 'saw' : track.voice === 'padString' ? 'string' : 'warm';
    for (const c of track.chords) {
      const start = at(c.t), held = Math.max(0.05, at(c.t + c.d) - start);
      // pads are low-passed (warm < 2 kHz, saw/string/choir < 5 kHz): synthesised at a quarter/half rate and interpolated up
      const factor = kind === 'warm' && !choir && !male && !hornPad && !aurora ? 4 : 2;
      const lowCtx = { sr: sr / factor, rng: ctx.rng };
      const low = male ? choirChord(lowCtx, c.ns.map(midiToHz), c.v, held, { vowel: 'oh', voices: 3, attack: Math.min(0.6, held * 0.3) })
        : hornPad ? hornChord(lowCtx, c.ns.map(midiToHz), c.v, held, { bright: 0.75 })
        : aurora ? auroraChord(lowCtx, c.ns.map(midiToHz), c.v, held)
        : choir ? choirChord(lowCtx, c.ns.map(midiToHz), c.v, held) : padChord(lowCtx, c.ns.map(midiToHz), c.v, held, kind, track.cutoff ? { cutoff: track.cutoff } : {});
      const s0 = place(Math.round(start * sr));
      mark(s0, addStereoUpsampled(st, low, factor, s0, 1, pan, track.width ?? 1));
      await check();
    }
  } else if (track.kind === 'kit') {
    for (const h of track.hits) {
      const k = h.k as KitHit, vel = Math.round(Math.min(1, h.v) * 12) / 12;
      const buf = cached(`${k}|${vel}`, 3, () => kit(ctx, k, vel));
      const s = Math.round(at(h.t) * sr) + human(track.humanize ?? 2);
      if (isStereo(buf)) putStereo(buf, s, 1, pan); else putMono(buf, s, 1, (KIT_PAN[k] ?? 0) * (track.width ?? 1) + pan);
      await check();
    }
  } else {
    for (const f of track.fx) {
      const start = at(f.t), dur = Math.max(0.05, at(f.t + f.d) - start), s = Math.round(start * sr);
      switch (f.k) {
        case 'riser': putStereo(riser(ctx, dur, 300, 5200, f.v), s, 1, pan); break;
        case 'sparkle': putStereo(sparkles(ctx, dur, f.density ?? 40, f.notes ?? [84, 86, 89, 91, 93, 96], f.v, f.shape ?? 'flat'), s, 1, pan, track.width ?? 1); break;
        case 'crash': putStereo(crash(ctx, f.v, Math.max(0.6, dur)), s, 1, pan); break;
        case 'impact': putMono(impact(ctx, f.v, 0.5), s, 1, pan); break;
        case 'whoosh': putStereo(whoosh(ctx, dur, 400, 3000, f.v), s, 1, pan); break;
        case 'room': putStereo(roomTone(ctx, dur, f.v), s, 1, pan, track.width ?? 1); break;
        case 'thunder': putStereo(thunderCrack(ctx, f.v, 1, Math.max(1.2, dur)), s, 1, pan, track.width ?? 1); break;
        case 'rumble': putStereo(thunderRumble(ctx, dur, f.v, f.density ?? 0.5), s, 1, pan, track.width ?? 1); break;
        case 'rain': putStereo(rain(ctx, dur, f.v, f.density ?? 1), s, 1, pan, track.width ?? 1); break;
        case 'wind': putStereo(wind(ctx, dur, f.v), s, 1, pan, track.width ?? 1); break;
        case 'water': putStereo(waterBed(ctx, dur, f.v, f.density ?? 1), s, 1, pan, track.width ?? 1); break;
        case 'courtyard': putStereo(courtyard(ctx, dur, f.v), s, 1, pan, track.width ?? 1); break;
        case 'whirr': putStereo(gearWhirr(ctx, dur, f.v, f.density ?? 70), s, 1, pan, track.width ?? 1); break;
        case 'pour': putStereo(pour(ctx, dur, f.v), s, 1, pan, track.width ?? 1); break;
        case 'steppe': putStereo(steppeNight(ctx, dur, f.v, { fire: f.density ?? 0 }), s, 1, pan, track.width ?? 1); break;
        case 'dawn': putStereo(dawnValley(ctx, dur, f.v), s, 1, pan, track.width ?? 1); break;
        case 'burner': putStereo(burnerRoar(ctx, dur, f.v, { heat: f.density ?? 0.5 }), s, 1, pan, track.width ?? 1); break;
        case 'fire': putStereo(fireCrackle(ctx, dur, f.v, f.density ?? 1), s, 1, pan, track.width ?? 1); break;
        case 'bubbles': putStereo(bubbles(ctx, dur, Math.max(1, Math.round((f.density ?? 20) * dur)), f.v, 380, 1700, f.shape === 'swell' ? 'swell' : f.shape === 'flat' ? 'flat' : 'decay'), s, 1, pan, track.width ?? 1); break;
        case 'swell': {
          // reversed cymbal that lands exactly on t + d
          const c = crash(ctx, f.v, dur * 1.1), n = Math.min(c.l.length, Math.round(dur * sr));
          const rev: Stereo = { l: c.l.slice(0, n).reverse(), r: c.r.slice(0, n).reverse() };
          putStereo(rev, s, 1, pan);
          break;
        }
      }
      await check();
    }
  }
  if (hi <= lo) return { lo: 0, hi: 0 };
  if (track.pump) applyPump(st, sr, score.bpm, track.pump, lo, hi);
  return { lo, hi };
}

/** Render length of a score in samples: the loop body (whole bars) and the extra tail for releases/reverb. */
export function scoreLength(score: Score, sampleRate: number): { body: number; total: number } {
  const body = score.loop
    ? loopLengthSamples(score.bars, score.bpm, score.beatsPerBar, sampleRate)
    : Math.round(beatToSeconds(score.bars * score.beatsPerBar, score.bpm) * sampleRate);
  return { body, total: body + Math.round(score.tail * sampleRate) };
}

/** Anti-aliased 2:1 decimation (4th-order Butterworth low-pass at 0.43 × the new rate). */
export function decimate2(x: Float32Array, sampleRate: number): Float32Array {
  const a = new Biquad(sampleRate).lowpass(sampleRate * 0.215, 0.5412), b = new Biquad(sampleRate).lowpass(sampleRate * 0.215, 1.3066);
  const n = x.length >> 1, out = new Float32Array(n);
  for (let i = 0; i < n; i++) { b.tick(a.tick(x[2 * i]!)); out[i] = b.tick(a.tick(x[2 * i + 1]!)); }
  return out;
}

/**
 * Phase 1 (worker or inline): synthesise the given tracks, balance each to its loudness target and sum
 * them into a dry bus and a (decimated) reverb-send bus.
 */
export async function synthTracks(score: Score, trackIds: string[] | null, env: RenderEnv): Promise<StemSum> {
  const sr = env.sampleRate, { total } = scoreLength(score, sr);
  const dry = stereo(total), send = stereo(total), scratch = stereo(total);
  for (const track of score.tracks) {
    if (trackIds && !trackIds.includes(track.id)) continue;
    const { lo, hi } = await renderTrack(score, track, scratch, env);
    if (hi <= lo) continue;
    const { l, r } = scratch;
    if (track.tame) tameStem(scratch, lo, hi, track.tame);
    // balance each stem to its loudness target (a decimated estimate is plenty for balancing)
    const m = loudness([l.subarray(lo, hi), r.subarray(lo, hi)], sr, 4).integrated;
    const gain = Number.isFinite(m) ? dbToGain(track.level - m) : 0, sg = gain * track.send;
    for (let i = lo; i < hi; i++) {
      const a = l[i]!, b = r[i]!;
      dry.l[i]! += a * gain; dry.r[i]! += b * gain;
      if (sg) { send.l[i]! += a * sg; send.r[i]! += b * sg; }
    }
    l.fill(0, lo, hi); r.fill(0, lo, hi);
    await env.tick();
  }
  // anything still ringing at the very end of the render fades out instead of being cut
  for (const ch of [dry.l, dry.r, send.l, send.r]) fadeEdges(ch, 0, Math.min(2048, total >> 2));
  return { dry, send: { l: decimate2(send.l, sr), r: decimate2(send.r, sr) } };
}

/**
 * Soft crest-factor control for a stem (only for tracks that ask for it with `tame`): the reference is the
 * gated mean power of 2048-sample blocks (blocks within 40 dB of the loudest), and every sample passes a
 * soft knee: linear up to half the ceiling, saturating at a ceiling `crestDb` above that RMS.
 */
export function tameStem(st: Stereo, lo: number, hi: number, crestDb: number): void {
  const B = 2048, powers: number[] = [];
  for (let a = lo; a < hi; a += B) {
    let s = 0; const b = Math.min(hi, a + B);
    for (let i = a; i < b; i++) s += st.l[i]! * st.l[i]! + st.r[i]! * st.r[i]!;
    powers.push(s / (2 * (b - a)));
  }
  const top = Math.max(...powers);
  if (!(top > 0)) return;
  const gated = powers.filter(p => p > top * 1e-4);
  const ref = Math.sqrt(gated.reduce((s, p) => s + p, 0) / gated.length), ceiling = ref * 10 ** (crestDb / 20);
  // linear up to half the ceiling, then a smooth (C1) knee that saturates at the ceiling
  const k = 0.5 * ceiling, span = ceiling - k;
  for (const ch of [st.l, st.r]) for (let i = lo; i < hi; i++) {
    const x = ch[i]!, a = x < 0 ? -x : x;
    if (a > k) ch[i] = (x < 0 ? -1 : 1) * (k + span * softClip((a - k) / span));
  }
}

/**
 * Phase 3a: dry partials + up-sampled wet, then the master EQ (rumble cut below 28 Hz, −1.5 dB shelf
 * from 9 kHz to keep the very top silky). For loops this runs before the tail is folded, which makes the EQ and the
 * reverb exactly circular (whatever rings past the end wraps around to the start).
 */
export function combineMix(dryParts: Stereo[], wet: Stereo | null, wetGain: number, sampleRate: number): Stereo {
  const n = dryParts[0]!.l.length;
  const mix = { l: dryParts[0]!.l, r: dryParts[0]!.r };
  for (const d of dryParts.slice(1)) for (let i = 0; i < n; i++) { mix.l[i]! += d.l[i]!; mix.r[i]! += d.r[i]!; }
  if (wet) {
    for (const [dst, src] of [[mix.l, wet.l], [mix.r, wet.r]] as const) {
      const m = src.length;
      for (let i = 0; i < m; i++) {
        const a = src[i]! * wetGain, b = (i + 1 < m ? src[i + 1]! : 0) * wetGain, j = 2 * i;
        if (j < n) dst[j]! += a;
        if (j + 1 < n) dst[j + 1]! += 0.5 * (a + b);
      }
    }
  }
  for (const ch of [mix.l, mix.r]) {
    for (const f of [new Biquad(sampleRate).highpass(28, 0.7), new Biquad(sampleRate).highShelf(9000, -1.5, 0.7)]) f.process(ch);
  }
  return mix;
}

/** Phase 3 (worker or inline): combine, fold the loop tail, normalise loudness, limit, trim one-shots. */
export function finishScore(score: Score, dryParts: Stereo[], wet: Stereo | null, sampleRate: number, renderMs: number): RenderedAsset {
  const { body } = scoreLength(score, sampleRate);
  const mixed = combineMix(dryParts, wet, dbToGain(score.reverbDb), sampleRate);
  let mix = score.loop ? foldLoop(mixed, body) : mixed;
  const m = master(mix, sampleRate, score.target, ASSET_CEILING_DB, score.loop);
  if (!score.loop) mix = trimStereo(mix);
  return {
    id: score.id, sampleRate, l: mix.l, r: mix.r, loop: score.loop, bpm: score.bpm, beatsPerBar: score.beatsPerBar, bars: score.bars,
    musicalEnd: beatToSeconds(score.musicalEnd ?? score.bars * score.beatsPerBar, score.bpm), renderMs, master: m,
  };
}

export async function scoreImpulse(env: RenderEnv, name: 'hall' | 'room'): Promise<Stereo> { return impulse(env, name); }

/** All three phases inline (no worker): used as the fallback, by tests and by the measurement harness. */
export async function renderScore(score: Score, env: RenderEnv): Promise<RenderedAsset> {
  const t0 = now();
  const sum = await synthTracks(score, null, env);
  const ir = await impulse(env, score.reverb);
  const wet = env.offline === false ? null : await reverbWet([sum.send], ir, env.sampleRate / REVERB_DECIMATION);
  await env.tick();
  return finishScore(score, [sum.dry], wet, env.sampleRate, now() - t0);
}

function trimStereo(st: Stereo, threshold = 1e-3): Stereo {
  let end = st.l.length;
  while (end > 256 && Math.abs(st.l[end - 1]!) < threshold && Math.abs(st.r[end - 1]!) < threshold) end--;
  const l = st.l.slice(0, end), r = st.r.slice(0, end);
  const fade = Math.min(1024, end >> 3);
  for (let i = 0; i < fade; i++) { const g = i / fade; l[end - 1 - i]! *= g; r[end - 1 - i]! *= g; }
  return { l, r };
}

/* ---------------- sound effects ---------------- */

/** Phase 1 for effects: synthesise every variation, laid end to end with room for the reverb tail. */
export async function synthSfx(defs: SfxDef[], env: RenderEnv, tailSamples: number): Promise<SfxSynth> {
  const sr = env.sampleRate;
  const built: { def: SfxDef; v: number; st: Stereo; offset: number }[] = [];
  let offset = 0;
  for (const def of defs) for (let v = 0; v < def.variations; v++) {
    if (env.cancelled?.()) throw new Cancelled();
    const ctx: VoiceCtx = { sr, rng: createRng(hashSeed(`sfx/${def.id}/${v}`)) };
    const raw = def.build(ctx, v);
    // drop the silent end of the fixed-size build buffer (keeps the concatenated reverb pass short)
    let end = raw.l.length, peak = 0;
    for (let i = 0; i < end; i++) peak = Math.max(peak, Math.abs(raw.l[i]!), Math.abs(raw.r[i]!));
    const floor = peak * 3e-4;
    while (end > 64 && Math.abs(raw.l[end - 1]!) < floor && Math.abs(raw.r[end - 1]!) < floor) end--;
    const st = end < raw.l.length ? { l: raw.l.subarray(0, end), r: raw.r.subarray(0, end) } : raw;
    const fade = Math.min(441, end >> 2); // 10 ms: a voice cut by the build buffer never clicks
    fadeEdges(st.l, 0, fade); fadeEdges(st.r, 0, fade);
    built.push({ def, v, st, offset });
    offset += st.l.length + (def.send > 0 ? tailSamples : 64);
    offset += offset & 1; // keep parts on even samples for the half-rate reverb
    await env.tick();
  }
  const dry = stereo(offset), send = stereo(offset);
  for (const p of built) { addStereo(dry, p.st, p.offset, 1); if (p.def.send > 0) addStereo(send, p.st, p.offset, p.def.send); }
  return {
    parts: built.map(p => ({ id: p.def.id, variation: p.v, offset: p.offset, length: p.st.l.length, reverb: p.def.send > 0, level: SFX_LEVELS[p.def.level] })),
    sum: { dry, send: { l: decimate2(send.l, sr), r: decimate2(send.r, sr) } },
  };
}

/** Phase 3 for effects: combine, slice each variation (with its tail), level it to its class target, limit, trim. */
export function finishSfx(parts: SfxPart[], dry: Stereo, wet: Stereo | null, sampleRate: number, tailSamples: number): Map<string, SfxClip[]> {
  const mix = combineMix([dry], wet, dbToGain(SFX_REVERB_DB), sampleRate);
  const out = new Map<string, SfxClip[]>();
  for (const p of parts) {
    const end = Math.min(mix.l.length, p.offset + p.length + (p.reverb ? tailSamples : 0));
    let clip: Stereo = { l: mix.l.slice(p.offset, end), r: mix.r.slice(p.offset, end) };
    master(clip, sampleRate, { lufs: p.level, measure: 'momentary' }, ASSET_CEILING_DB, false);
    clip = trimStereo(clip);
    const list = out.get(p.id) ?? [];
    list.push({ id: p.id, variation: p.variation, l: clip.l, r: clip.r, sampleRate });
    out.set(p.id, list);
  }
  return out;
}

/** Effects, all phases inline. */
export async function renderSfx(defs: SfxDef[], env: RenderEnv): Promise<Map<string, SfxClip[]>> {
  const ir = await impulse(env, 'room'), tail = sfxTail(ir);
  const synth = await synthSfx(defs, env, tail);
  const wet = env.offline === false ? null : await reverbWet([synth.sum.send], ir, env.sampleRate / REVERB_DECIMATION);
  return finishSfx(synth.parts, synth.sum.dry, wet, env.sampleRate, tail);
}

/** Wet return of the effects room. */
export const SFX_REVERB_DB = -4;
