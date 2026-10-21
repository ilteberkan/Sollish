/**
 * Göreme: Şafak Balonları presentation timeline. Pure: converts an already-resolved `GoremeRound` (engine
 * `goreme-balloons-1`) into an ordered list of timed events. It never reads a clock, the DOM or randomness and only
 * re-states engine numbers (every grid, balloon, multiplier, sky value and total comes from the round's integers), so the
 * speed setting, reduced motion or a tapped hold screen change timing but never a displayed amount, a grid or a payout.
 *
 * Every visual and audio beat binds to these timestamps: the game calls the board, the canvas FX, the sky band and the
 * sound from the same event. Board animation lengths travel inside the events (`stops`, `dropMs`, `ms`), so the board
 * animates exactly as long as the timeline waits. Balloons keep their engine cell id across lifts, drifts and merges.
 *
 * Time unit: ms from the round start. Grid coordinates: col 0..5 (reel), row 0..4 (row 0 on top), grid[col][row].
 *
 * Engine data -> events (packages/protocol/src/goreme.ts, step order in GoremeSpin):
 *   spin start          -> spin-start (free spins: counter, sky value)
 *   spin (whole board)  -> spin (reels drop in and stop one by one), reel-stop per reel, balloon-land per landed balloon,
 *                          sun-land per sun (n-th of the board), sun-tease (two suns down, reels still turning: the later
 *                          reels slow down, presentation only)
 *   ways                -> win (cells highlighted, the cumulative meter adds the board win), callout (way multiplier ≥ 10)
 *   scatter             -> scatter (suns flare; base: pay + award, free: +5 spins)
 *   lift                -> lift (burner flames, wind), lift-move (rise one row + drift with the wind; exits fly away or
 *                          head for the sky band), merge (two balloons in one cell become one, ×sum)
 *   sky                 -> sky (moored balloons join the band, Gök ×N ticks; callout when it reaches ≥ 10)
 *   respin              -> respin (every non-balloon cell drops in fresh), balloon-land per new balloon
 *   spin end            -> trigger / free-intro / free-mode (base), spin-end
 *   round end           -> free-outro (always after free spins), total-win (<10×) or big-win (≥10×, Azami when capped), end
 */
import {
  GOREME_MAX_WIN_MULTIPLIER, GOREME_REELS, GOREME_ROWS,
  type GoremeBalloon, type GoremeExit, type GoremeGrid, type GoremeLiftMove, type GoremeMerge, type GoremePaySymbol, type GoremeRound, type GoremeWind,
} from '@sollish/protocol';
import { fixed2 } from './slot-format';
import type { Locale } from './i18n/config';
import { countUpSchedule, multiplierCalloutTier, roundCelebration, type CelebrationLevel, type CountUpSchedule, type WinTier } from './slot-kit/win-tiers';

export type GoremeSpeed = 'normal' | 'quick' | 'turbo';
/** Board / FX duration factor (normal 1, quick 0.6, turbo 0.35). */
export const GOREME_SPEED_FACTOR: Readonly<Record<GoremeSpeed, number>> = Object.freeze({ normal: 1, quick: 0.6, turbo: 0.35 });
/** Holds (free-spin intro, total screen) never shrink below this in turbo so the text stays readable. */
export const GOREME_TURBO_MIN_HOLD = 1500;
/** "Giriş ekranlarını atla": the intro and total screens still show, this long at most. */
export const GOREME_SKIP_SCREEN_HOLD = 900;

export interface GoremeTimelineOptions { speed?: GoremeSpeed; reducedMotion?: boolean; skipScreens?: boolean }

/** Hundredths of the bet: this spin's running win and the capped, CUMULATIVE round total (never decreases). */
export interface GoremeMeter { spin: number; total: number }
export type GoremePos = readonly [number, number];
export interface GoremeTimelineWin {
  symbol: GoremePaySymbol; length: number; ways: number; multiplierProduct: number;
  /** Ten-thousandths of the bet, before the sky. */
  payTenThousandths: number;
  cells: number[];
}
export interface GoremeMoored { id: number; multiplier: number }

type At = { at: number; dur: number };
export type GoremeEvent =
  | At & { type: 'spin-start'; spin: number; kind: 'base' | 'free'; freeSpinNumber: number; freeSpinsLeft: number; meter: GoremeMeter; sky: number }
  /** A whole fresh board: the old symbols leave, the new ones drop in reel by reel; reel c stops `stops[c]` ms after `at`. */
  | At & { type: 'spin'; spin: number; grid: GoremeGrid; stops: number[]; dropMs: number; tease: number | null }
  | At & { type: 'reel-stop'; spin: number; reel: number }
  | At & { type: 'balloon-land'; spin: number; id: number; col: number; row: number; multiplier: number }
  /** The n-th sun of this board lands. */
  | At & { type: 'sun-land'; spin: number; n: number; id: number; col: number; row: number }
  /** Two suns are down and reels are still turning: the remaining reels slow down. */
  | At & { type: 'sun-tease'; spin: number; on: boolean }
  /** Ways wins of one board: their cells glow, the meter adds the board win (sky applied). */
  | At & { type: 'win'; spin: number; step: number; wins: GoremeTimelineWin[]; cells: number[]; stepHundredths: number; sky: number; meter: GoremeMeter; best: GoremePaySymbol }
  /** A big way multiplier (balloons × sky ≥ 10) or a sky value ≥ 10 gets its own big text and sound. */
  | At & { type: 'callout'; spin: number; value: number; tier: WinTier; source: 'ways' | 'sky' }
  | At & { type: 'scatter'; spin: number; count: number; cells: number[]; payHundredths: number; freeSpins: number; retrigger: boolean; meter: GoremeMeter }
  /** Burners flare under every balloon on the board; the wind picks its direction. */
  | At & { type: 'lift'; spin: number; step: number; lift: number; wind: GoremeWind; shift: -1 | 0 | 1; balloons: GoremeBalloon[] }
  /** Balloons rise one row and drift with the wind; exits leave through the top (fly away, or moor in the sky band). */
  | At & { type: 'lift-move'; spin: number; step: number; moves: GoremeLiftMove[]; exits: GoremeExit[]; ms: number }
  | At & { type: 'merge'; spin: number; step: number; merges: GoremeMerge[]; ms: number }
  /** Moored balloons join the sky band; the sky multiplier ticks from `before` to `after`. */
  | At & { type: 'sky'; spin: number; moored: GoremeMoored[]; before: number; after: number }
  /** Every non-balloon cell is dealt again; column c starts `delays[c]` ms after `at`. */
  | At & { type: 'respin'; spin: number; step: number; grid: GoremeGrid; drops: number[]; delays: number[]; dropMs: number }
  | At & { type: 'trigger'; spin: number; count: number; awarded: number; freeSpinsLeft: number }
  | At & { type: 'free-intro'; spin: number; awarded: number; hold: true }
  | At & { type: 'free-mode'; on: boolean; freeSpinsLeft: number }
  | At & { type: 'spin-end'; spin: number; kind: 'base' | 'free'; winHundredths: number; meter: GoremeMeter; freeSpinsLeft: number; sky: number }
  /** "Şafak Şöleni — Toplam": always ends a free-spin round. */
  | At & { type: 'free-outro'; spins: number; totalHundredths: number; sky: number; moored: number; celebration: boolean; capped: boolean; hold: true }
  /** Short total-win flourish on the meter for a winning round below 10× without free spins. */
  | At & { type: 'total-win'; totalHundredths: number }
  | At & { type: 'big-win'; tier: CelebrationLevel; totalHundredths: number; capped: boolean; countUp: number; schedule: CountUpSchedule; hold: true }
  | At & { type: 'end'; totalHundredths: number; payoutCents: number; capped: boolean };
export type GoremeEventType = GoremeEvent['type'];

export interface GoremeTimeline { events: GoremeEvent[]; duration: number; speed: GoremeSpeed; skipScreens: boolean; reducedMotion: boolean }

/** Base timings (ms, normal speed). Reduced motion keeps every step with short fades. */
const NORMAL = {
  spinStart: 120, freeSpinStart: 380,
  reelFirst: 420, reelGap: 150, teaseGap: 560, drop: 380, reelTail: 140,
  respinLead: 60, respinGap: 55, settle: 90,
  win: 900, winLate: 620, callout: 1300,
  scatter: 1300, retrigger: 1200,
  burn: 360, move: 760, merge: 720, skyTick: 900, skyCallout: 1300,
  trigger: 1300, freeIntro: 3400, freeOutro: 3600, totalWin: 900,
  spinEndWin: 520, spinEndNone: 240, freeSpinEndWin: 600, freeSpinEndNone: 220,
};
const REDUCED: typeof NORMAL = {
  ...NORMAL, reelFirst: 160, reelGap: 40, teaseGap: 200, drop: 160, respinGap: 0, burn: 200, move: 360, merge: 360, callout: 900, scatter: 900, trigger: 900,
};

/** floor(bet × hundredths / 100): the engine's payout rule, used for every displayed amount. */
export function goremeCents(betCents: number, hundredths: number): number {
  return Math.floor((betCents * hundredths) / 100);
}

const sunsOf = (grid: GoremeGrid) => {
  const out: Array<{ id: number; col: number; row: number }> = [];
  for (let col = 0; col < GOREME_REELS; col++) for (let row = 0; row < GOREME_ROWS; row++) if (grid[col]![row]!.symbol === 'sun') out.push({ id: grid[col]![row]!.id, col, row });
  return out;
};

/** Way multiplier the callout announces for one ways step: balloons × sky (free spins only when balloons take part), or 0. */
export function goremeWaysCallout(wins: readonly { multiplierProduct: number }[], sky: number, free: boolean): number {
  if (!wins.length) return 0;
  const product = Math.max(...wins.map(w => w.multiplierProduct));
  if (free && product < 2) return 0;
  const value = product * Math.max(1, sky);
  return value >= 10 ? value : 0;
}

export function buildGoremeTimeline(round: GoremeRound, options: GoremeTimelineOptions = {}): GoremeTimeline {
  const speed: GoremeSpeed = options.speed ?? 'normal';
  const turbo = speed === 'turbo', reducedMotion = !!options.reducedMotion, skipScreens = !!options.skipScreens;
  const T = reducedMotion ? REDUCED : NORMAL;
  const k = GOREME_SPEED_FACTOR[speed];
  const d = (ms: number) => Math.round(ms * k);
  const hold = (ms: number) => (turbo ? Math.max(GOREME_TURBO_MIN_HOLD, d(ms)) : ms);
  const screen = (ms: number) => (skipScreens ? Math.min(GOREME_SKIP_SCREEN_HOLD, hold(ms)) : hold(ms));
  const cap = GOREME_MAX_WIN_MULTIPLIER * 100;
  const events: GoremeEvent[] = [];
  const push = (event: GoremeEvent) => { events.push(event); };
  let t = 0, prevTotal = 0, freeNumber = 0, freeLeft = 0, mooredCount = 0, skyShown = 1;

  for (const spin of round.spins) {
    const s = spin.index, free = spin.kind === 'free';
    if (free) { freeNumber++; freeLeft = Math.max(0, freeLeft - 1); }
    let running = 0;
    const meter = (): GoremeMeter => ({ spin: Math.min(running, cap - prevTotal), total: Math.min(cap, prevTotal + running) });
    const startDur = d(free ? T.freeSpinStart : T.spinStart);
    push({ type: 'spin-start', at: t, dur: startDur, spin: s, kind: spin.kind, freeSpinNumber: freeNumber, freeSpinsLeft: freeLeft, meter: meter(), sky: spin.skyBefore });
    t += startDur;

    let waysIndex = 0;
    for (let i = 0; i < spin.steps.length; i++) {
      const step = spin.steps[i]!;
      switch (step.type) {
        case 'spin': {
          // Reels stop left to right; with two suns down the later reels slow down (tease). Presentation only.
          const suns = sunsOf(step.grid);
          const stops: number[] = [];
          let at = d(T.reelFirst), tease: number | null = null, sunsSoFar = 0;
          for (let col = 0; col < GOREME_REELS; col++) {
            if (col > 0) at += tease !== null ? d(T.teaseGap) : d(T.reelGap);
            stops.push(at);
            sunsSoFar += suns.filter(x => x.col === col).length;
            if (tease === null && sunsSoFar >= 2 && col < GOREME_REELS - 1) tease = col + 1;
          }
          const dropMs = d(T.drop);
          const dur = stops[GOREME_REELS - 1]! + d(T.reelTail);
          push({ type: 'spin', at: t, dur, spin: s, grid: step.grid, stops, dropMs, tease });
          stops.forEach((ms, reel) => push({ type: 'reel-stop', at: t + ms, dur: 0, spin: s, reel }));
          for (const b of step.balloons) push({ type: 'balloon-land', at: t + stops[b.col]! + 1, dur: 0, spin: s, id: b.id, col: b.col, row: b.row, multiplier: b.multiplier });
          suns.forEach((x, n) => push({ type: 'sun-land', at: t + stops[x.col]! + 2, dur: 0, spin: s, n: n + 1, id: x.id, col: x.col, row: x.row }));
          if (tease !== null) {
            push({ type: 'sun-tease', at: t + stops[tease - 1]! + 3, dur: 0, spin: s, on: true });
            push({ type: 'sun-tease', at: t + dur, dur: 0, spin: s, on: false });
          }
          t += dur + d(T.settle);
          break;
        }
        case 'respin': {
          const freshByCol = new Array<number>(GOREME_REELS).fill(0);
          for (const dr of step.drops) freshByCol[dr.col]!++;
          const delays = Array.from({ length: GOREME_REELS }, (_, col) => d(T.respinLead + col * T.respinGap));
          const dropMs = d(T.drop);
          const dur = delays[GOREME_REELS - 1]! + dropMs + d(T.settle);
          push({ type: 'respin', at: t, dur, spin: s, step: i, grid: step.grid, drops: step.drops.map(dr => dr.id), delays, dropMs });
          for (const b of step.balloons) push({ type: 'balloon-land', at: t + delays[b.col]! + dropMs, dur: 0, spin: s, id: b.id, col: b.col, row: b.row, multiplier: b.multiplier });
          if (free) sunsOf(step.grid).filter(x => step.drops.some(dr => dr.id === x.id)).forEach((x, n) => push({ type: 'sun-land', at: t + delays[x.col]! + dropMs + 1, dur: 0, spin: s, n: n + 1, id: x.id, col: x.col, row: x.row }));
          t += dur;
          break;
        }
        case 'ways': {
          waysIndex++;
          if (!step.wins.length) break;
          running += step.winHundredths;
          const wins: GoremeTimelineWin[] = step.wins.map(w => ({ symbol: w.symbol, length: w.length, ways: w.ways, multiplierProduct: w.multiplierProduct, payTenThousandths: w.payTenThousandths, cells: w.cells.slice() }));
          const cells = [...new Set(wins.flatMap(w => w.cells))];
          const best = step.wins.reduce((m, w) => (w.payTenThousandths > m.payTenThousandths ? w : m)).symbol;
          // Long lift chains tighten after the 6th board of a spin (the hold, never a board animation).
          const winDur = d(waysIndex > 6 ? T.winLate : T.win);
          push({ type: 'win', at: t, dur: winDur, spin: s, step: i, wins, cells, stepHundredths: step.winHundredths, sky: step.skyMultiplier, meter: meter(), best });
          t += winDur;
          const value = goremeWaysCallout(step.wins, step.skyMultiplier, free);
          if (value > 0) {
            const dur = d(T.callout);
            push({ type: 'callout', at: t - Math.round(winDur * 0.5), dur, spin: s, value, tier: multiplierCalloutTier(value), source: 'ways' });
            t += Math.round(dur * 0.6);
          }
          break;
        }
        case 'scatter': {
          const retrigger = free;
          if (!retrigger) running += step.payHundredths;
          const dur = d(retrigger ? T.retrigger : T.scatter);
          push({ type: 'scatter', at: t, dur, spin: s, count: step.count, cells: step.cells.slice(), payHundredths: step.payHundredths, freeSpins: step.freeSpins, retrigger, meter: meter() });
          t += dur;
          break;
        }
        case 'lift': {
          const burn = d(T.burn), move = d(T.move);
          push({ type: 'lift', at: t, dur: burn, spin: s, step: i, lift: step.lift, wind: step.wind, shift: step.shift, balloons: liftBalloonsBefore(step.moves, step.exits) });
          t += burn;
          push({ type: 'lift-move', at: t, dur: move, spin: s, step: i, moves: step.moves.map(m => ({ ...m })), exits: step.exits.map(e => ({ ...e })), ms: move });
          t += move;
          if (step.merges.length) {
            const ms = d(T.merge);
            push({ type: 'merge', at: t, dur: ms, spin: s, step: i, merges: step.merges.map(m => ({ ...m })), ms });
            t += ms;
          }
          break;
        }
        case 'sky': {
          mooredCount += step.moored.length;
          const dur = d(T.skyTick);
          push({ type: 'sky', at: t, dur, spin: s, moored: step.moored.map(m => ({ ...m })), before: step.skyBefore, after: step.skyAfter });
          t += dur;
          if (step.skyAfter >= 10 && step.skyAfter > skyShown) {
            const cdur = d(T.skyCallout);
            push({ type: 'callout', at: t - Math.round(dur * 0.4), dur: cdur, spin: s, value: step.skyAfter, tier: multiplierCalloutTier(step.skyAfter), source: 'sky' });
            t += Math.round(cdur * 0.5);
          }
          skyShown = step.skyAfter;
          break;
        }
      }
    }

    const awarded = Math.min(spin.scatterSpinsAwarded, spin.freeSpinsAwarded);
    if (!free && awarded > 0) {
      const dur = d(T.trigger);
      push({ type: 'trigger', at: t, dur, spin: s, count: spin.scatterCount, awarded, freeSpinsLeft: spin.freeSpinsLeft });
      t += dur;
      const introDur = screen(T.freeIntro);
      push({ type: 'free-intro', at: t, dur: introDur, spin: s, awarded, hold: true });
      t += introDur;
      push({ type: 'free-mode', at: t, dur: 0, on: true, freeSpinsLeft: spin.freeSpinsLeft });
    }
    freeLeft = spin.freeSpinsLeft;
    const spinWin = spin.totalHundredthsAfter - prevTotal;
    const endDur = d(free ? (spinWin > 0 ? T.freeSpinEndWin : T.freeSpinEndNone) : (spinWin > 0 ? T.spinEndWin : T.spinEndNone));
    push({ type: 'spin-end', at: t, dur: endDur, spin: s, kind: spin.kind, winHundredths: spinWin, meter: { spin: spinWin, total: spin.totalHundredthsAfter }, freeSpinsLeft: spin.freeSpinsLeft, sky: spin.skyAfter });
    t += endDur;
    prevTotal = spin.totalHundredthsAfter;
  }

  const celebration = roundCelebration(round.totalHundredths, round.capped);
  if (round.freeSpinsTriggered) {
    const last = round.spins[round.spins.length - 1]!;
    const outroDur = screen(T.freeOutro);
    push({ type: 'free-outro', at: t, dur: outroDur, spins: round.spins.length - 1, totalHundredths: round.totalHundredths, sky: last.skyAfter, moored: mooredCount, celebration: celebration === 'celebration', capped: round.capped, hold: true });
    t += outroDur;
  } else if (celebration === 'flourish') {
    const dur = d(T.totalWin);
    push({ type: 'total-win', at: t, dur, totalHundredths: round.totalHundredths });
    t += dur;
  }
  if (celebration === 'celebration') {
    const schedule = countUpSchedule(round.totalHundredths, round.capped, { speed, skipScreens, reducedMotion });
    const total = schedule.countUp + schedule.hold;
    push({ type: 'big-win', at: t, dur: total, tier: schedule.finalLevel, totalHundredths: round.totalHundredths, capped: round.capped, countUp: schedule.countUp, schedule, hold: true });
    t += total;
  }
  push({ type: 'end', at: t, dur: 0, totalHundredths: round.totalHundredths, payoutCents: round.payoutCents, capped: round.capped });
  events.sort((a, b) => a.at - b.at); // stable: equal times keep insertion order
  return { events, duration: t, speed, skipScreens, reducedMotion };
}

/** The balloons of a lift as they stood before it (positions from the moves and exits, multipliers before the rise). */
function liftBalloonsBefore(moves: readonly GoremeLiftMove[], exits: readonly GoremeExit[]): GoremeBalloon[] {
  const out: GoremeBalloon[] = [
    ...moves.map(m => ({ id: m.id, col: m.from[0], row: m.from[1], multiplier: m.multiplierBefore })),
    ...exits.map(e => ({ id: e.id, col: e.from[0], row: e.from[1], multiplier: Math.max(1, e.multiplier - 1) })),
  ];
  return out.sort((a, b) => a.col - b.col || a.row - b.row);
}

/** The board at the very end of the round (grid [col][row]). */
export function goremeFinalBoard(round: GoremeRound): GoremeGrid {
  return round.spins[round.spins.length - 1]!.finalGrid;
}

/** Fixed two-decimal amount: 3510 -> "35,10" (tr, the default) / "35.10" (en). Pass the active locale for display. */
export function goremeMoney(cents: number, locale: Locale = 'tr'): string { return fixed2(cents / 100, locale); }
/** Hundredths of the bet as a multiple: 1240 -> "12,40". */
export function goremeTimes(hundredths: number, locale: Locale = 'tr'): string { return fixed2(hundredths / 100, locale); }

/** What a history row says, as data: the screens turn it into text in the active language (`goreme.history.detail.*`). */
export type GoremeHistorySummary =
  | { kind: 'capped'; total: number }
  | { kind: 'free'; spins: number; sky: number; total: number }
  | { kind: 'none'; total: number }
  | { kind: 'base'; wins: number; lifts: number; total: number };
export function goremeHistorySummary(round: GoremeRound): GoremeHistorySummary {
  const total = round.totalHundredths;
  if (round.capped) return { kind: 'capped', total };
  if (round.freeSpinsTriggered) {
    const last = round.spins[round.spins.length - 1]!;
    return { kind: 'free', spins: round.spins.length - 1, sky: last.skyAfter, total };
  }
  if (total === 0) return { kind: 'none', total };
  const base = round.spins[0]!;
  const wins = base.steps.reduce((n, st) => n + (st.type === 'ways' ? st.wins.length : 0), 0);
  return { kind: 'base', wins, lifts: base.lifts, total };
}
/** History row text stored with the record (Turkish): "3 yol kazancı · 2 kalkış · 1,48×", "Şafak Şöleni ×10 · Gök ×12 · 89,56×", "Kazanç yok". */
export function goremeHistoryDetail(round: GoremeRound): string {
  const s = goremeHistorySummary(round);
  const total = `${goremeTimes(s.total)}×`;
  switch (s.kind) {
    case 'capped': return `Azami kazanç · ${total}`;
    case 'free': return `Şafak Şöleni ×${s.spins} · Gök ×${s.sky} · ${total}`;
    case 'none': return 'Kazanç yok';
    case 'base': return `${s.wins} yol kazancı${s.lifts > 0 ? ` · ${s.lifts} kalkış` : ''} · ${total}`;
  }
}
