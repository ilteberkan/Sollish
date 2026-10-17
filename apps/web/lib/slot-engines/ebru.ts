import { playEbruRound, ebruSeedFromEntropy, type EbruMode } from '@sollish/protocol';
import { defineSlotEngine } from '../rgs-client';

/** ebru's protocol engine, and nothing else: import this (not lib/slot-engines/all.ts) from the ebru route. */
export const EBRU_ENGINE = defineSlotEngine({
  game: 'ebru',
  seedFromEntropy: ebruSeedFromEntropy,
  play: (seedHex: string, betCents: number, mode: string) => playEbruRound(seedHex, betCents, mode as EbruMode),
});
