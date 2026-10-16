/**
 * Shared "never annoying" policy for the recorded character voices of every slot game (Candy Cascade, Tarhun, Ebru,
 * Cezeri, Asena). Pure logic, no Web Audio, so it is unit tested in Node. Presentation only: it decides whether a
 * line is spoken, never what a round pays.
 *
 * Rules (owner decision, 16 Oct 2026):
 *  - at most one line per MIN_GAP seconds (tier and feature lines are exempt from the gap: they are the headline of
 *    a win or a feature and the engine already plays one voice at a time by priority);
 *  - the same line is not repeated within REPEAT_WINDOW seconds (tier lines excepted, so a max win is always heard);
 *  - multiplier callouts speak from ×10 up; the ×2–9 remark ("minor") is at most once per MINOR_COOLDOWN seconds
 *    and, by default, only for games that opt in (Tarhun) or at the "Full" voice level;
 *  - ambient remarks ("nice", laughs) at most once per AMBIENT_COOLDOWN seconds and never in turbo or autoplay;
 *  - in turbo or autoplay only tier and feature lines are spoken;
 *  - voice level: Full (everything above), Key moments (default: tier, feature, callouts from ×10), Off.
 */

export const VOICE_LEVELS = ['full', 'key', 'off'] as const;
export type VoiceLevel = (typeof VOICE_LEVELS)[number];
export const DEFAULT_VOICE_LEVEL: VoiceLevel = 'key';

/** Untrusted value (storage, hand edits) to a valid level. */
export function sanitizeVoiceLevel(value: unknown, fallback: VoiceLevel = DEFAULT_VOICE_LEVEL): VoiceLevel {
  return typeof value === 'string' && (VOICE_LEVELS as readonly string[]).includes(value) ? (value as VoiceLevel) : fallback;
}

export type VoiceCategory = 'tier' | 'feature' | 'callout' | 'minor' | 'moment' | 'ambient';

export const MIN_GAP = 2.5;
export const REPEAT_WINDOW = 20;
export const MINOR_COOLDOWN = 30;
export const AMBIENT_COOLDOWN = 60;

const FEATURE_LINES = new Set(['feature-trigger', 'feature-start', 'feature-end', 'retrigger', 'map-spins', 'mult-2', 'mult-3', 'mult-5', 'chain-max']);
const AMBIENT_LINES = new Set(['nice', 'laugh']);
const CALLOUT_LINE = /^x(10|25|50|100|250|500)$/;
const MINOR_LINE = /^x2(-9)?$/;

/**
 * Category of a voice-line file stem, the same naming in all five games:
 * `win-*` tier; `x10`…`x500` callout; `x2` / `x2-9` minor; `nice` / `laugh` ambient; feature entry/exit/retrigger,
 * Asena's mountain multipliers and Cezeri's full chain feature; everything else (teases, locks, templates…) is a moment.
 */
export function voiceCategory(line: string): VoiceCategory {
  if (line.startsWith('win-')) return 'tier';
  if (CALLOUT_LINE.test(line)) return 'callout';
  if (MINOR_LINE.test(line)) return 'minor';
  if (AMBIENT_LINES.has(line)) return 'ambient';
  if (FEATURE_LINES.has(line)) return 'feature';
  return 'moment';
}

export type VoiceVerdict = 'allow' | 'off' | 'level' | 'fast' | 'gap' | 'repeat' | 'cooldown';

export interface VoicePolicyOptions {
  /** Speak the ×2–9 remark also at the "Key moments" level (Tarhun). Default false. */
  minorInKey?: boolean;
  minGap?: number;
  repeatWindow?: number;
  minorCooldown?: number;
  ambientCooldown?: number;
}

export interface VoicePolicy {
  setLevel: (level: VoiceLevel) => void;
  /** True in turbo spin speed or autoplay: only tier and feature lines are spoken. */
  setFast: (fast: boolean) => void;
  readonly level: VoiceLevel;
  readonly fast: boolean;
  /** Would this line be spoken at `now` (seconds on any monotonic clock)? Does not change state. */
  check: (line: string, now: number) => VoiceVerdict;
  /** The line really played at `now`: starts the spacing and cooldown clocks. */
  commit: (line: string, now: number) => void;
  /** check, then `play()`; commits only when `play` reports that the line was spoken. */
  request: (line: string, now: number, play: () => boolean | null | undefined | string) => boolean;
  reset: () => void;
}

export function createVoicePolicy(options: VoicePolicyOptions = {}): VoicePolicy {
  const minGap = options.minGap ?? MIN_GAP, repeatWindow = options.repeatWindow ?? REPEAT_WINDOW;
  const minorCooldown = options.minorCooldown ?? MINOR_COOLDOWN, ambientCooldown = options.ambientCooldown ?? AMBIENT_COOLDOWN;
  let level: VoiceLevel = DEFAULT_VOICE_LEVEL, fast = false;
  let lastAny = -Infinity, lastMinor = -Infinity, lastAmbient = -Infinity;
  const lastLine = new Map<string, number>();

  const check = (line: string, now: number): VoiceVerdict => {
    if (level === 'off') return 'off';
    const cat = voiceCategory(line);
    const headline = cat === 'tier' || cat === 'feature';
    if (fast && !headline) return 'fast';
    if (level === 'key') {
      const inKey = headline || cat === 'callout' || (cat === 'minor' && options.minorInKey === true);
      if (!inKey) return 'level';
    }
    // a clock that went backwards (new audio context) must not block speech forever
    const since = (t: number) => (t > now ? Infinity : now - t);
    if (cat !== 'tier') {
      const prev = lastLine.get(line);
      if (prev !== undefined && since(prev) < repeatWindow) return 'repeat';
    }
    if (!headline && since(lastAny) < minGap) return 'gap';
    if (cat === 'minor' && since(lastMinor) < minorCooldown) return 'cooldown';
    if (cat === 'ambient' && since(lastAmbient) < ambientCooldown) return 'cooldown';
    return 'allow';
  };
  const commit = (line: string, now: number) => {
    lastAny = now; lastLine.set(line, now);
    const cat = voiceCategory(line);
    if (cat === 'minor') lastMinor = now;
    if (cat === 'ambient') lastAmbient = now;
  };
  return {
    setLevel: l => { level = sanitizeVoiceLevel(l, level); },
    setFast: f => { fast = !!f; },
    get level() { return level; },
    get fast() { return fast; },
    check,
    commit,
    request: (line, now, play) => {
      if (check(line, now) !== 'allow') return false;
      if (!play()) return false;
      commit(line, now);
      return true;
    },
    reset: () => { lastAny = lastMinor = lastAmbient = -Infinity; lastLine.clear(); },
  };
}

/** What the hooks pass to an engine's `setVoicePolicy`: the saved level, and "fast" in turbo or autoplay. */
export function voicePolicyInput(settings: { voice?: unknown; spinSpeed?: unknown }, autoplay: boolean): { level: VoiceLevel; fast: boolean } {
  return { level: sanitizeVoiceLevel(settings.voice), fast: autoplay || settings.spinSpeed === 'turbo' };
}
