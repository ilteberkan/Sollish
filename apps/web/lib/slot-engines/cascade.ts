import { playCascade2Round, cascadeSeedFromEntropy, type CascadeMode } from '@sollish/protocol';
import { defineSlotEngine } from '../rgs-client';

/** cascade's protocol engine, and nothing else: import this (not lib/slot-engines/all.ts) from the cascade route. */
export const CASCADE_ENGINE = defineSlotEngine({
  game: 'cascade',
  seedFromEntropy: cascadeSeedFromEntropy,
  play: (seedHex: string, betCents: number, mode: string) => playCascade2Round(seedHex, betCents, mode as CascadeMode),
});
