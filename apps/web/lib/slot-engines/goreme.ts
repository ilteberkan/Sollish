import { playGoremeRound, goremeSeedFromEntropy, type GoremeMode } from '@sollish/protocol';
import { defineSlotEngine } from '../rgs-client';

/** goreme's protocol engine, and nothing else: import this (not lib/slot-engines/all.ts) from the goreme route. */
export const GOREME_ENGINE = defineSlotEngine({
  game: 'goreme',
  seedFromEntropy: goremeSeedFromEntropy,
  play: (seedHex: string, betCents: number, mode: string) => playGoremeRound(seedHex, betCents, mode as GoremeMode),
});
