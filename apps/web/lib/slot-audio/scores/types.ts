import type { HitEvent, NoteEvent } from './notation';

export type PitchedVoice = 'celesta' | 'musicBox' | 'glock' | 'marimba' | 'pluck' | 'synthLead' | 'bass' | 'bassDrive' | 'bell' | 'timpani' | 'brass'
  // Tarhun (storm-throne) voices, synth/anatolian.ts
  | 'zurna' | 'zurnaSoft' | 'ney' | 'baglama' | 'horn' | 'hornSwell' | 'bronze' | 'taikoPitched'
  // Ebru (ebru-ink) voices, synth/ebru.ts
  | 'kanun' | 'kanunSoft' | 'ud' | 'glassHarp' | 'waterGlass'
  // Cezeri (cezeri-gears) voices, synth/cezeri.ts
  | 'santur' | 'santurSoft' | 'pipe' | 'waterOrgan' | 'chimeRod' | 'drip'
  // Asena (asena-stars) voices, synth/asena.ts
  | 'kopuz' | 'kopuzMute' | 'kilKopuz' | 'khoomei' | 'kargyraa' | 'starBell'
  // Göreme (goreme-balloons) voices: a bağlama-like lute whose sympathetic strings are tuned to F (F2 C3 F3), synth/anatolian.ts
  | 'dawnSaz';
export type PadVoice = 'padWarm' | 'padSaw' | 'padString' | 'padChoir' | 'padChoirMale' | 'padHorn'
  // Asena: the aurora pad
  | 'padAurora';
export type KitHit = 'kick' | 'kickSoft' | 'kickPunch' | 'brush' | 'snare' | 'clap' | 'hat' | 'hatOpen' | 'shaker' | 'snap' | 'wood' | 'woodHi' | 'tomHi' | 'tomMid' | 'tomLo' | 'timp' | 'timpLo' | 'crash'
  | 'davul' | 'davulLo' | 'davulRim' | 'dum' | 'tek' | 'ka' | 'frame' | 'taiko' | 'taikoLo'
  | 'kudumDum' | 'kudumTek' | 'zil' | 'frameLo'
  // Cezeri: the clock mechanism and the automaton band
  | 'escTick' | 'escTock' | 'ratchet' | 'clank' | 'naqDum' | 'naqTek' | 'kos' | 'kosLo' | 'cymbal' | 'cymbalSoft'
  // Asena: shaman frame drum (kam davulu) and its pendants, gallop hoofbeats, the Ergenekon forge
  | 'kamDum' | 'kamTek' | 'kamJingle' | 'hoof' | 'anvil';
export type FxKind = 'riser' | 'sparkle' | 'crash' | 'impact' | 'whoosh' | 'swell' | 'room' | 'thunder' | 'rumble' | 'rain' | 'wind'
  // Ebru: still-water bed and bubble bursts
  | 'water' | 'bubbles'
  // Cezeri: courtyard fountain + water clock bed, gear-train whirr, a vessel filling
  | 'courtyard' | 'whirr' | 'pour'
  // Asena: steppe night wind bed (grass, crickets) and a distant camp fire
  | 'steppe' | 'fire'
  // Göreme: dawn valley bed (breeze, distant birds and burners) and a balloon burner burst
  | 'dawn' | 'burner';

export interface PadEvent { t: number; d: number; ns: number[]; v: number }
export interface FxEvent { t: number; d: number; k: FxKind; v: number; notes?: number[]; density?: number; shape?: 'swell' | 'decay' | 'flat' }

interface TrackBase {
  id: string;
  /** Loudness (LUFS) this stem is balanced to before the mix bus; the master then normalises the sum. */
  level: number;
  pan?: number;
  /** Stereo width for stereo stems (1 = as rendered). */
  width?: number;
  /** Reverb send, linear 0..1. */
  send: number;
  /** Sidechain-style pump depth 0..1, locked to the beat. */
  pump?: number;
  /** Timing jitter in ms (seeded). */
  humanize?: number;
  /** Swing applies to this track (default true). */
  swing?: boolean;
  /**
   * Optional soft peak control of the stem before balancing: peaks are softly saturated toward this many
   * dB above the stem's gated RMS (crest-factor ceiling, e.g. 12 for punchy drums). Unset = untouched.
   */
  tame?: number;
}
export interface PitchedTrack extends TrackBase { kind: 'pitched'; voice: PitchedVoice; notes: NoteEvent[]; transpose?: number; bright?: number }
export interface PadTrack extends TrackBase { kind: 'pad'; voice: PadVoice; chords: PadEvent[]; cutoff?: number }
export interface KitTrack extends TrackBase { kind: 'kit'; hits: HitEvent[] }
export interface FxTrack extends TrackBase { kind: 'fx'; fx: FxEvent[] }
export type Track = PitchedTrack | PadTrack | KitTrack | FxTrack;

export interface Score {
  id: string;
  bpm: number;
  beatsPerBar: number;
  bars: number;
  /** Off-beat eighth position, 0.5 = straight. */
  swing: number;
  /** Looping scene (tail folded onto the start) or one-shot stinger. */
  loop: boolean;
  /** Seconds rendered past the end for releases and reverb. */
  tail: number;
  reverb: 'hall' | 'room';
  /** Wet return level in dB. */
  reverbDb: number;
  tracks: Track[];
  /** Mastering target. */
  target: { lufs: number; measure: 'integrated' | 'momentary' };
  /** Stingers: beat at which the next scene may enter (the musical end). */
  musicalEnd?: number;
  /** Musical description for the report and the lab page. */
  about: string;
}
