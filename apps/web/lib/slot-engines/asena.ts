import { playAsenaRound, asenaSeedFromEntropy, type AsenaMode } from '@sollish/protocol';
import { defineSlotEngine } from '../rgs-client';

/** asena's protocol engine, and nothing else: import this (not lib/slot-engines/all.ts) from the asena route. */
export const ASENA_ENGINE = defineSlotEngine({
  game: 'asena',
  seedFromEntropy: asenaSeedFromEntropy,
  play: (seedHex: string, betCents: number, mode: string) => playAsenaRound(seedHex, betCents, mode as AsenaMode),
});
