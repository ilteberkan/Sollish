import { playCezeriRound, cezeriSeedFromEntropy, type CezeriMode } from '@sollish/protocol';
import { defineSlotEngine } from '../rgs-client';

/** cezeri's protocol engine, and nothing else: import this (not lib/slot-engines/all.ts) from the cezeri route. */
export const CEZERI_ENGINE = defineSlotEngine({
  game: 'cezeri',
  seedFromEntropy: cezeriSeedFromEntropy,
  play: (seedHex: string, betCents: number, mode: string) => playCezeriRound(seedHex, betCents, mode as CezeriMode),
});
