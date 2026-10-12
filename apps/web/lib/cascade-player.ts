/**
 * Candy Cascade timeline player: the shared slot-kit player (lib/slot-kit/timeline-player.ts) typed for the
 * Candy Cascade timeline. Behaviour is unchanged; see the shared module for the clock rules.
 */
import { TimelinePlayer as SlotTimelinePlayer } from './slot-kit/timeline-player';
import type { TimelineEvent } from './cascade-timeline';

export type { EventInfo, FrameScheduler } from './slot-kit/timeline-player';

export class TimelinePlayer extends SlotTimelinePlayer<TimelineEvent> {}
