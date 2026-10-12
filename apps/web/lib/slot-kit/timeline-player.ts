/**
 * Plays a presentation timeline (any slot: Candy Cascade, Tarhun …) on a virtual clock. Each frame advances the
 * clock by the real frame interval, clamped to `maxStep` so a slow or resumed frame delays the show instead of
 * skipping through it. A hidden tab simply stops receiving frames (the presentation pauses); the result and payout
 * are already fixed, so nothing here can change them. Events fire exactly once, in order.
 */

/** Minimal event shape: `hold` marks a screen the player may tap through (intro card, total screen, celebration). */
export interface PlayableEvent { type: string; at: number; dur: number; hold?: true }
export interface PlayableTimeline<E extends PlayableEvent> { events: readonly E[] }
export type FrameScheduler = { request: (callback: (now: number) => void) => number; cancel: (handle: number) => void };
export type EventInfo = { late: number; jumped: boolean };

const browserScheduler: FrameScheduler = {
  request: callback => requestAnimationFrame(callback),
  cancel: handle => cancelAnimationFrame(handle),
};

export class TimelinePlayer<E extends PlayableEvent> {
  private clock = 0;
  private next = 0;
  private handle = 0;
  private last: number | null = null;
  private running = false;
  private done = false;
  constructor(
    private readonly timeline: PlayableTimeline<E>,
    private readonly onEvent: (event: E, info: EventInfo) => void,
    private readonly scheduler: FrameScheduler = browserScheduler,
    private readonly maxStep = 64,
  ) {}
  get time(): number { return this.clock; }
  get finished(): boolean { return this.done; }
  get active(): boolean { return this.running; }
  start(): void {
    if (this.running || this.done) return;
    this.running = true; this.last = null;
    this.advance(this.clock, false); // events at t = 0 fire synchronously
    if (this.running) this.handle = this.scheduler.request(this.tick);
  }
  /** Stops without firing the remaining events (unmount; the caller applies the final state). */
  stop(): void {
    this.running = false;
    this.scheduler.cancel(this.handle);
  }
  /** Moves the clock forward (tap to continue a hold or to finish a count-up). Never moves back. */
  jumpTo(time: number): void {
    if (!this.running || time <= this.clock) return;
    this.advance(time, true);
  }
  /** The hold event (intro card, total screen, celebration) that contains the current time, if any. */
  currentHold(): Extract<E, { hold: true }> | null {
    for (let i = this.next - 1; i >= 0; i--) {
      const event = this.timeline.events[i]!;
      if (event.hold && this.clock >= event.at && this.clock < event.at + event.dur) return event as Extract<E, { hold: true }>;
      if (event.at + event.dur < this.clock - 10_000) break;
    }
    return null;
  }
  private tick = (now: number): void => {
    if (!this.running) return;
    const dt = this.last === null ? 0 : Math.min(this.maxStep, Math.max(0, now - this.last));
    this.last = now;
    this.advance(this.clock + dt, false);
    if (this.running) this.handle = this.scheduler.request(this.tick);
  };
  private advance(target: number, jumped: boolean): void {
    this.clock = target;
    const events = this.timeline.events;
    while (this.running && this.next < events.length && events[this.next]!.at <= this.clock) {
      const event = events[this.next++]!;
      this.onEvent(event, { late: this.clock - event.at, jumped });
    }
    if (this.next >= events.length && !this.done) { this.done = true; this.stop(); }
  }
}
