import { playStormRound, stormSeedFromEntropy, type StormMode } from '@sollish/protocol';
import { defineSlotEngine } from '../rgs-client';

/** tarhun's protocol engine, and nothing else: import this (not lib/slot-engines/all.ts) from the tarhun route. */
export const TARHUN_ENGINE = defineSlotEngine({
  game: 'tarhun',
  seedFromEntropy: stormSeedFromEntropy,
  play: (seedHex: string, betCents: number, mode: string) => playStormRound(seedHex, betCents, mode as StormMode),
});
