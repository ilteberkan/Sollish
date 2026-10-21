import { playDamlaRound, damlaSeedFromEntropy, type DamlaMode } from '@sollish/protocol';
import { defineSlotEngine } from '../rgs-client';

/** damla's protocol engine, and nothing else: import this (not lib/slot-engines/all.ts) from the damla route. */
export const DAMLA_ENGINE = defineSlotEngine({
  game: 'damla',
  seedFromEntropy: damlaSeedFromEntropy,
  play: (seedHex: string, betCents: number, mode: string) => playDamlaRound(seedHex, betCents, mode as DamlaMode),
});
