/**
 * Cezeri: Zamanın Çarkları presentation timeline. Pure: converts an already-resolved `CezeriRound` (engine
 * `cezeri-gears-1`) into an ordered list of timed events. It never reads a clock, the DOM or randomness and only
 * re-states engine numbers (every meter, hub value and total comes from the round's integers), so the speed setting,
 * reduced motion or a tapped screen can change timing but never a displayed total.
 *
 * One clock for every beat: a `rotate` event carries the exact ring plans (components/cezeri/geometry.ts
 * cezeriRotateTiming) that the board animates and the sound engine schedules its ratchet clicks on, and the next
 * event starts when the slowest ring has settled. The falcon's flight uses cezeriFalconPlan the same way.
 *
 * Engine step order per spin: hub → rotate → win* → [lock → hub(+1) → rotate → win*]* → end → [scatter] → [falcon].
 * Shown as: spin-start → hub (reveal) → rotate (+ ring-stop / vessel-land) → win* → lock → hub (tick, the signature
 * moment) → rotate … → chain-end (clamps lift) → [scatter → scatter-pay → free-intro → free-mode] → [reservoir →
 * falcon → falcon-drop* → reservoir-drain] → spin-end; then free-outro / total-win / big-win → end.
 *
 * Time unit: ms from the round start. Board coordinates: [ring 0..3 inner → outer, slice 0..11 clockwise from 12 o'clock].
 */
import {
  CEZERI_MAX_RESPINS, CEZERI_MAX_WIN_MULTIPLIER, CEZERI_RESERVOIR_LEVELS, CEZERI_RINGS, CEZERI_SLICES,
  type CezeriBoard, type CezeriPaySymbol, type CezeriPos, type CezeriRingSpin, type CezeriRound, type CezeriSymbol,
} from '@sollish/protocol';
import { cezeriFalconPlan, cezeriRotateTiming, type CzRotateKind } from '../components/cezeri/geometry';
import { countUpSchedule, multiplierCalloutTier, roundCelebration, type CelebrationLevel, type CountUpSchedule, type WinTier } from './slot-kit/win-tiers';

export type CezeriSpeed = 'normal' | 'quick' | 'turbo';
export const CEZERI_SPEED_FACTOR: Readonly<Record<CezeriSpeed, number>> = Object.freeze({ normal: 1, quick: 0.6, turbo: 0.35 });
/** Holds (free-spin intro, total screen) never shrink below this in turbo so the text stays readable. */
export const CEZERI_TURBO_MIN_HOLD = 1500;
/** "Giriş ekranlarını atla": the free-spin intro and total screens still show, this long at most. */
export const CEZERI_SKIP_SCREEN_HOLD = 900;

export interface CezeriTimelineOptions { speed?: CezeriSpeed; reducedMotion?: boolean; skipScreens?: boolean }

/** Hundredths of the bet: this spin's running win and the capped, CUMULATIVE round total (never decreases). */
export interface CezeriMeter { spin: number; total: number }
/** One ring of a rotate event: the plan the board animates and the ratchet the sound plays (`ms` = whole turn). */
export interface CezeriRingTimingInfo { ring: number; ms: number; distance: number; held: number }

type At = { at: number; dur: number };
export type CezeriEvent =
  | At & { type: 'spin-start'; spin: number; kind: 'base' | 'free'; freeSpinNumber: number; freeSpinsLeft: number; wilds: CezeriPos[]; meter: CezeriMeter }
  /** Hub value for rotation `round`. round 0: the draw (or the carried hub); round k: previous + 1 (the escalating tick). */
  | At & { type: 'hub'; spin: number; round: number; reason: 'spin' | 'respin'; value: number; previous: number; carried: number; calloutTier: WinTier }
  /** All four rings turn (respin: under the held slices). `kind` picks the plan shape, `speed` its factor. */
  | At & { type: 'rotate'; spin: number; round: number; kind: CzRotateKind; speed: number; rings: CezeriRingSpin[]; timing: CezeriRingTimingInfo[]; board: CezeriBoard }
  /** A ring has settled (thud, sparks). `vessels` = vessels visible on the rings settled so far in this rotation. */
  | At & { type: 'ring-stop'; spin: number; round: number; ring: number; last: boolean }
  /** The n-th vessel of this rotation came to rest (1..). */
  | At & { type: 'vessel-land'; spin: number; round: number; n: number; cells: CezeriPos[] }
  /** One new spoke win: beam from the hub outward; the meter adds `winHundredths` (= pay increment × hub). */
  | At & {
    type: 'win'; spin: number; round: number; index: number; spoke: number; symbol: CezeriPaySymbol | 'gear'; length: 3 | 4; startRing: 0 | 1; cells: CezeriPos[];
    wildRings: number[]; fullHundredths: number; paidBefore: number; payHundredths: number; hub: number; winHundredths: number; meter: CezeriMeter;
  }
  /** Dişli Kilidi: the new winning slices clamp (heavy clank); `respin` = all rings wind again. */
  | At & { type: 'lock'; spin: number; round: number; held: CezeriPos[]; newHeld: CezeriPos[]; respin: boolean }
  /** The chain is over: the clamps lift. */
  | At & { type: 'chain-end'; spin: number; rotations: number; respins: number; hub: number; heldSlices: number; chainCapped: boolean; chainHundredths: number }
  /** Vessels on the final board; `forged` were turned into vessels by the buy guarantee (board = final board). */
  | At & { type: 'scatter'; spin: number; kind: 'base' | 'free'; count: number; cells: CezeriPos[]; forged: CezeriPos[]; board: CezeriBoard; awarded: number; retrigger: boolean; freeSpinsLeft: number }
  | At & { type: 'scatter-pay'; spin: number; count: number; hundredths: number; meter: CezeriMeter }
  | At & { type: 'free-intro'; spin: number; awarded: number; hold: true }
  | At & { type: 'free-mode'; on: boolean; freeSpinsLeft: number }
  /** Fil Saati reservoir after a free spin (1..3). */
  | At & { type: 'reservoir'; spin: number; level: number }
  /** The falcon flies over `order` of `ring` (flight order); `before` = wilds before this visit. */
  | At & { type: 'falcon'; spin: number; ring: number; order: number[]; wilds: CezeriPos[]; before: CezeriPos[]; speed: number }
  /** One gear wild lands; `pinned` = every pinned wild now. */
  | At & { type: 'falcon-drop'; spin: number; ring: number; slice: number; index: number; count: number; pinned: CezeriPos[] }
  | At & { type: 'reservoir-drain'; spin: number }
  | At & { type: 'spin-end'; spin: number; kind: 'base' | 'free'; winHundredths: number; hub: number; meter: CezeriMeter }
  /** "Fil Saati — Toplam": always ends a free-spin round. */
  | At & { type: 'free-outro'; spins: number; totalHundredths: number; topHub: number; falconVisits: number; wilds: number; celebration: boolean; capped: boolean; hold: true }
  /** Short total-win flourish on the meter for a winning round below 10× without free spins. */
  | At & { type: 'total-win'; totalHundredths: number }
  | At & { type: 'big-win'; tier: CelebrationLevel; totalHundredths: number; capped: boolean; countUp: number; schedule: CountUpSchedule; hold: true }
  | At & { type: 'end'; totalHundredths: number; payoutCents: number; capped: boolean };
export type CezeriEventType = CezeriEvent['type'];

export interface CezeriTimeline { events: CezeriEvent[]; duration: number; speed: CezeriSpeed; skipScreens: boolean; reducedMotion: boolean }

/** Base timings (ms, normal speed). Reduced motion keeps every step with short swaps and fades. */
const NORMAL = {
  spinStart: 160, freeSpinStart: 420,
  /** The hub reveal starts with the crank; the rings start this much later. */
  hubLead: 240,
  rotateTail: 40, settle: 140,
  winGap: 260, winBeam: 700, afterWins: 180,
  lock: 460, hubTick: 680, chainEnd: 560, chainEndShort: 160, noWin: 120,
  scatter: 1900, forge: 600, retrigger: 1500, scatterPay: 760, freeIntro: 2800,
  reservoir: 700, falconTail: 200, drain: 520,
  spinEndWin: 560, spinEndNone: 260, freeSpinEndWin: 640, freeSpinEndNone: 260,
  freeOutro: 3200, totalWin: 900,
  reducedRotate: 300,
};
const REDUCED: typeof NORMAL = {
  ...NORMAL,
  hubLead: 120, winGap: 140, winBeam: 320, lock: 200, hubTick: 320, chainEnd: 260,
  scatter: 1000, forge: 300, retrigger: 900, reservoir: 360, drain: 200,
};

/** floor(bet × hundredths / 100): the engine's payout rule, used for every displayed amount. */
export function cezeriCents(betCents: number, hundredths: number): number {
  return Math.floor((betCents * hundredths) / 100);
}
const posKey = ([r, s]: CezeriPos) => r * CEZERI_SLICES + s;
const vesselsOf = (board: CezeriBoard, uptoRing: number): CezeriPos[] => {
  const out: CezeriPos[] = [];
  for (let r = 0; r <= uptoRing && r < CEZERI_RINGS; r++) for (let s = 0; s < CEZERI_SLICES; s++) if (board[r]![s] === 'vessel') out.push([r, s]);
  return out;
};

export function buildCezeriTimeline(round: CezeriRound, options: CezeriTimelineOptions = {}): CezeriTimeline {
  const speed: CezeriSpeed = options.speed ?? 'normal';
  const turbo = speed === 'turbo', reducedMotion = !!options.reducedMotion, skipScreens = !!options.skipScreens;
  const T = reducedMotion ? REDUCED : NORMAL;
  const k = CEZERI_SPEED_FACTOR[speed];
  const d = (ms: number) => Math.round(ms * k);
  const hold = (ms: number) => (turbo ? Math.max(CEZERI_TURBO_MIN_HOLD, d(ms)) : ms);
  const screen = (ms: number) => (skipScreens ? Math.min(CEZERI_SKIP_SCREEN_HOLD, hold(ms)) : hold(ms));
  const cap = CEZERI_MAX_WIN_MULTIPLIER * 100;
  const events: CezeriEvent[] = [];
  const push = (event: CezeriEvent) => { events.push(event); };
  let t = 0, prevTotal = 0, freeNumber = 0, freeSpinsLeft = 0, shownHub = 0, topHub = 0, falconVisits = 0;
  let wilds: CezeriPos[] = [];

  for (const spin of round.spins) {
    const s = spin.index;
    if (spin.kind === 'free') { freeNumber++; freeSpinsLeft = Math.max(0, freeSpinsLeft - 1); }
    let running = 0;
    const meter = (): CezeriMeter => ({ spin: Math.min(running, cap - prevTotal), total: Math.min(cap, prevTotal + running) });
    const startDur = d(spin.kind === 'free' ? T.freeSpinStart : T.spinStart);
    push({ type: 'spin-start', at: t, dur: startDur, spin: s, kind: spin.kind, freeSpinNumber: freeNumber, freeSpinsLeft, wilds: wilds.map(p => [p[0], p[1]] as const), meter: meter() });
    t += startDur;
    if (spin.kind === 'base') shownHub = 0;

    let winIndex = 0;
    for (const step of spin.steps) {
      switch (step.type) {
        case 'hub': {
          const respin = step.reason === 'respin';
          const tier = multiplierCalloutTier(step.value);
          const calloutTier = (tier > multiplierCalloutTier(shownHub) ? tier : 0) as WinTier;
          const dur = respin ? d(T.hubTick) : d(T.hubLead);
          push({ type: 'hub', at: t, dur, spin: s, round: step.round, reason: step.reason, value: step.value, previous: respin ? step.previous : shownHub, carried: step.carried, calloutTier });
          shownHub = step.value; topHub = Math.max(topHub, step.value);
          t += dur;
          break;
        }
        case 'rotate': {
          const kind: CzRotateKind = step.round === 0 ? 'first' : 'respin';
          const plans = cezeriRotateTiming(kind, k);
          const timing: CezeriRingTimingInfo[] = step.rings.map(ring => {
            const plan = plans[ring.ring]!.plan;
            return { ring: ring.ring, ms: reducedMotion ? d(T.reducedRotate) : plan.total, distance: reducedMotion ? 0 : plan.distance, held: ring.held.length };
          });
          const dur = Math.max(...timing.map(x => x.ms)) + d(T.rotateTail);
          push({ type: 'rotate', at: t, dur, spin: s, round: step.round, kind, speed: k, rings: step.rings.map(r => ({ ...r, slices: r.slices.slice(), held: r.held.slice(), pinned: r.pinned.slice() })), timing, board: step.board.map(r => r.slice()) });
          // ring stops in settle order; vessels counted on the rings that have stopped
          const order = [...timing].sort((a, b) => a.ms - b.ms || a.ring - b.ring);
          let seen = 0;
          const stopped = new Set<number>();
          order.forEach((x, i) => {
            const stopAt = t + x.ms;
            push({ type: 'ring-stop', at: stopAt, dur: 0, spin: s, round: step.round, ring: x.ring, last: i === order.length - 1 });
            stopped.add(x.ring);
            const visible: CezeriPos[] = [];
            for (const r of stopped) for (let sl = 0; sl < CEZERI_SLICES; sl++) if (step.board[r]![sl] === 'vessel') visible.push([r, sl]);
            visible.sort((a, b) => posKey(a) - posKey(b));
            while (seen < visible.length) { seen++; push({ type: 'vessel-land', at: stopAt, dur: 0, spin: s, round: step.round, n: seen, cells: visible.slice() }); }
          });
          t += dur + d(T.settle);
          winIndex = 0;
          break;
        }
        case 'win': {
          running += step.winHundredths;
          const beam = d(T.winBeam);
          push({
            type: 'win', at: t, dur: beam, spin: s, round: step.round, index: winIndex, spoke: step.spoke, symbol: step.symbol, length: step.length, startRing: step.startRing,
            cells: step.cells.map(p => [p[0], p[1]] as const), wildRings: step.wildRings.slice(), fullHundredths: step.fullHundredths, paidBefore: step.paidBefore,
            payHundredths: step.payHundredths, hub: step.hub, winHundredths: step.winHundredths, meter: meter(),
          });
          winIndex++;
          // wins of one rotation overlap: the next beam starts winGap later; the lock waits for the last beam
          t += d(T.winGap);
          break;
        }
        case 'lock': {
          // finish the last beam of this rotation before the clamps slam
          t += Math.max(0, d(T.winBeam) - d(T.winGap)) + d(T.afterWins);
          const dur = d(T.lock);
          push({ type: 'lock', at: t, dur, spin: s, round: step.round, held: step.held.map(p => [p[0], p[1]] as const), newHeld: step.newHeld.map(p => [p[0], p[1]] as const), respin: step.respin });
          t += dur;
          break;
        }
        case 'end': {
          const dur = step.respins > 0 ? d(T.chainEnd) : step.chainHundredths > 0 ? d(T.chainEndShort) : d(T.noWin);
          push({ type: 'chain-end', at: t, dur, spin: s, rotations: step.rotations, respins: step.respins, hub: step.hub, heldSlices: step.heldSlices, chainCapped: step.chainCapped, chainHundredths: step.chainHundredths });
          t += dur;
          break;
        }
        case 'scatter': {
          const retrigger = spin.kind === 'free';
          const awarded = spin.freeSpinsAwarded;
          const forgeDur = step.forged.length ? d(T.forge) : 0;
          const dur = forgeDur + (awarded > 0 ? d(retrigger ? T.retrigger : T.scatter) : d(T.reservoir));
          if (awarded > 0) freeSpinsLeft = spin.freeSpinsLeft;
          push({ type: 'scatter', at: t, dur, spin: s, kind: spin.kind, count: step.count, cells: step.cells.map(p => [p[0], p[1]] as const), forged: step.forged.map(p => [p[0], p[1]] as const), board: spin.board.map(r => r.slice()), awarded, retrigger, freeSpinsLeft: spin.freeSpinsLeft });
          t += dur;
          if (step.payHundredths > 0) {
            running += step.payHundredths;
            const payDur = d(T.scatterPay);
            push({ type: 'scatter-pay', at: t, dur: payDur, spin: s, count: step.count, hundredths: step.payHundredths, meter: meter() });
            t += payDur;
          }
          if (awarded > 0 && !retrigger) {
            const introDur = screen(T.freeIntro);
            push({ type: 'free-intro', at: t, dur: introDur, spin: s, awarded, hold: true });
            t += introDur;
            push({ type: 'free-mode', at: t, dur: 0, on: true, freeSpinsLeft: spin.freeSpinsLeft });
          }
          break;
        }
        case 'falcon': break; // handled after the reservoir below (engine order: falcon is last)
      }
    }

    // Fil Saati: the reservoir rises after every free spin; at the top the falcon (if the engine sent it) pins gears.
    if (spin.kind === 'free') {
      const level = Math.min(CEZERI_RESERVOIR_LEVELS, spin.reservoir);
      const resDur = d(T.reservoir);
      push({ type: 'reservoir', at: t, dur: resDur, spin: s, level });
      t += resDur;
      const falcon = spin.steps.find((x): x is Extract<CezeriRound['spins'][number]['steps'][number], { type: 'falcon' }> => x.type === 'falcon');
      if (falcon) {
        falconVisits++;
        const plan = cezeriFalconPlan(falcon.ring, falcon.slices, reducedMotion ? 1 : k);
        const flight = reducedMotion ? d(T.reservoir) : plan.end;
        const before = wilds.map(p => [p[0], p[1]] as const);
        push({ type: 'falcon', at: t, dur: flight, spin: s, ring: falcon.ring, order: plan.order.slice(), wilds: falcon.wilds.map(p => [p[0], p[1]] as const), before, speed: k });
        const pinned: CezeriPos[] = before.slice();
        plan.order.forEach((slice, i) => {
          pinned.push([falcon.ring, slice]);
          const at = reducedMotion ? t + Math.round((flight * (i + 1)) / (plan.order.length + 1)) : t + plan.drops[i]!;
          push({ type: 'falcon-drop', at, dur: 0, spin: s, ring: falcon.ring, slice, index: i, count: plan.order.length, pinned: pinned.slice().sort((a, b) => posKey(a) - posKey(b)) });
        });
        t += flight + d(T.falconTail);
        wilds = falcon.wilds.map(p => [p[0], p[1]] as const);
      }
      if (level >= CEZERI_RESERVOIR_LEVELS) {
        const drainDur = d(T.drain);
        push({ type: 'reservoir-drain', at: t, dur: drainDur, spin: s });
        t += drainDur;
      }
    }

    freeSpinsLeft = spin.freeSpinsLeft;
    const spinWin = spin.totalHundredthsAfter - prevTotal;
    const endDur = d(spin.kind === 'free' ? (spinWin > 0 ? T.freeSpinEndWin : T.freeSpinEndNone) : (spinWin > 0 ? T.spinEndWin : T.spinEndNone));
    push({ type: 'spin-end', at: t, dur: endDur, spin: s, kind: spin.kind, winHundredths: spinWin, hub: spin.hubEnd, meter: { spin: spinWin, total: spin.totalHundredthsAfter } });
    t += endDur;
    prevTotal = spin.totalHundredthsAfter;
  }

  const celebration = roundCelebration(round.totalHundredths, round.capped);
  if (round.freeSpinsTriggered) {
    const outroDur = screen(T.freeOutro);
    push({ type: 'free-outro', at: t, dur: outroDur, spins: round.spins.length - 1, totalHundredths: round.totalHundredths, topHub, falconVisits, wilds: wilds.length, celebration: celebration === 'celebration', capped: round.capped, hold: true });
    t += outroDur;
  } else if (celebration === 'flourish') {
    const flourishDur = d(T.totalWin);
    push({ type: 'total-win', at: t, dur: flourishDur, totalHundredths: round.totalHundredths });
    t += flourishDur;
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

/** The board the round ends on (the last spin's final board) and the hub value shown last. */
export function cezeriFinalBoard(round: CezeriRound): { board: CezeriBoard; hub: number } {
  const spin = round.spins[round.spins.length - 1]!;
  return { board: spin.board.map(r => r.slice()), hub: spin.hubEnd };
}

/* ------------------------------------------------------------------ formatting */
let twoDecimals: Intl.NumberFormat | null = null;
const fixed2 = () => (twoDecimals ??= new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
/** Fixed two-decimal amount: 3510 -> "35,10". */
export function cezeriMoney(cents: number): string { return fixed2().format(cents / 100); }
/** Hundredths of the bet as a multiple: 1240 -> "12,40". */
export function cezeriTimes(hundredths: number): string { return fixed2().format(hundredths / 100); }

/** History row text: "2 yeniden dönüş · göbek ×5 · 3,40×", "Fil Saati ×12 · göbek ×14 · 183,50×", "Kazanç yok". */
export function cezeriHistoryDetail(round: CezeriRound): string {
  const total = `${cezeriTimes(round.totalHundredths)}×`;
  if (round.capped) return `Azami kazanç · ${total}`;
  if (round.freeSpinsTriggered) {
    const top = Math.max(...round.spins.map(s => s.hubEnd));
    return `Fil Saati ×${round.spins.length - 1} · göbek ×${top} · ${total}`;
  }
  if (round.totalHundredths === 0) return 'Kazanç yok';
  const base = round.spins[0]!;
  return `${base.respins > 0 ? `${base.respins} yeniden dönüş · ` : ''}göbek ×${base.hubEnd} · ${total}`;
}

/** Screen-reader line for one spoke win: "Işın 4: 3 Fil Saati, göbek ×3, 0,69× kazanç". */
export function cezeriWinAnnouncement(win: { spoke: number; length: number; symbol: string; hub: number; winHundredths: number; paidBefore: number }, labels: Record<string, string>): string {
  const name = labels[win.symbol] ?? win.symbol;
  return `Işın ${win.spoke + 1}: ${win.length} ${name}${win.paidBefore > 0 ? ' (uzadı)' : ''}, göbek ×${win.hub}, ${cezeriTimes(win.winHundredths)}× kazanç`;
}

/** Ring/slice of a board position as text: "halka 2, dilim 7". */
export const cezeriPosText = ([ring, slice]: CezeriPos) => `halka ${ring + 1}, dilim ${slice + 1}`;
/** For tests and the screen: the respin cap the chain counter shows. */
export const CEZERI_CHAIN_CAP = CEZERI_MAX_RESPINS;
export type { CezeriSymbol };
