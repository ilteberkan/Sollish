/** Browser-side verification for /verify and /replay: recompute a server round from its revealed seed with the same
 * protocol engine and compare. Pure and testable; the network part lives in rgs-client.ts. */
import { ASENA_ENGINE_ID, CEZERI_ENGINE_ID, EBRU_ENGINE_ID, SLOT_GAMES, isClientSeed, isSlotNonce, slotGame, verifySlotRound, type AsenaRound, type CezeriRound, type EbruGrid, type EbruRound, type EbruStains, type SlotRoundSummary, type SlotVerifyResult } from '@sollish/protocol';
import type { RemoteHistoryRow, RemoteReplay } from './rgs-client';

export interface VerifyFormInput {
  game: string; serverSeed: string; serverSeedHash?: string; clientSeed: string; nonce: string | number; betCents: string | number; mode: string;
  /** Optional claims to compare (from a history row or a screenshot). */
  expectedSeedHex?: string; expectedPayoutCents?: string | number;
}
export type VerifyStatus = 'match' | 'mismatch' | 'invalid';
/** `code` names the translated text (`verify.outcome.<code>`); `failed` lists the failed checks of a mismatch (`verify.checks.<name>`).
 * `message` is the same text in Turkish (tests, legacy callers). */
export type VerifyCode = 'game' | 'serverSeed' | 'serverSeedHash' | 'clientSeed' | 'nonce' | 'bet' | 'mode' | 'expectedSeed' | 'expectedPayout' | 'engineRejected' | 'match' | 'mismatch';
export interface VerifyOutcome { status: VerifyStatus; code: VerifyCode; message: string; failed?: string[]; result: SlotVerifyResult | null }

const INVALID_TEXT: Readonly<Record<Exclude<VerifyCode, 'match' | 'mismatch' | 'engineRejected'>, string>> = {
  game: 'Oyun tanınmadı.',
  serverSeed: 'Sunucu tohumu 64 onaltılık karakter olmalı (açıklanmış tohum).',
  serverSeedHash: 'Tohum özeti 64 onaltılık karakter olmalı.',
  clientSeed: 'Oyuncu tohumu 1–64 karakter olmalı: harf, rakam, _ veya -.',
  nonce: 'Nonce 0 veya daha büyük bir tam sayı olmalı.',
  bet: 'Bahis bu oyunun bahis basamaklarından biri olmalı.',
  mode: 'Mod bu oyunda yok.',
  expectedSeed: 'Beklenen tur tohumu 32 onaltılık karakter olmalı.',
  expectedPayout: 'Beklenen kazanç tam sayı (DEMO kuruş) olmalı.',
};
const invalid = (code: keyof typeof INVALID_TEXT): VerifyOutcome => ({ status: 'invalid', code, message: INVALID_TEXT[code], result: null });
const hex = (value: string | undefined) => (value ?? '').trim().toLowerCase();
function integer(value: string | number | undefined): number | null {
  if (value === undefined || value === '') return null;
  const text = String(value).trim();
  return /^\d{1,15}$/.test(text) ? Number(text) : Number.NaN;
}

export async function verifyForm(input: VerifyFormInput): Promise<VerifyOutcome> {
  const game = slotGame(input.game.trim());
  if (!game) return invalid('game');
  const serverSeed = hex(input.serverSeed);
  if (!/^[0-9a-f]{64}$/.test(serverSeed)) return invalid('serverSeed');
  const serverSeedHash = hex(input.serverSeedHash);
  if (serverSeedHash && !/^[0-9a-f]{64}$/.test(serverSeedHash)) return invalid('serverSeedHash');
  const clientSeed = input.clientSeed.trim();
  if (!isClientSeed(clientSeed)) return invalid('clientSeed');
  const nonce = integer(input.nonce);
  if (nonce === null || !isSlotNonce(nonce)) return invalid('nonce');
  const betCents = integer(input.betCents);
  if (betCents === null || !game.betLevels.includes(betCents)) return invalid('bet');
  if (!game.modes.includes(input.mode)) return invalid('mode');
  const expectedSeedHex = hex(input.expectedSeedHex);
  if (expectedSeedHex && !/^[0-9a-f]{32}$/.test(expectedSeedHex)) return invalid('expectedSeed');
  const expectedPayout = integer(input.expectedPayoutCents);
  if (Number.isNaN(expectedPayout)) return invalid('expectedPayout');
  const result = await verifySlotRound(game, { serverSeed, serverSeedHash: serverSeedHash || undefined, clientSeed, nonce, betCents, mode: input.mode },
    { seedHex: expectedSeedHex || undefined, payoutCents: expectedPayout ?? undefined });
  if (result.error === 'ENGINE_REJECTED_INPUT') return { status: 'invalid', code: 'engineRejected', message: 'Motor bu bahis/mod bileşimini kabul etmedi.', result };
  if (result.ok) return { status: 'match', code: 'match', message: 'Eşleşti: sonuç bu tohumlardan yeniden hesaplandı.', result };
  const names = Object.entries(result.checks).filter(([, ok]) => ok === false).map(([name]) => name);
  return { status: 'mismatch', code: 'mismatch', message: `Uyuşmuyor: ${names.map(name => CHECK_LABELS[name] ?? name).join(', ')}.`, failed: names, result };
}
const CHECK_LABELS: Record<string, string> = { hash: 'tohum özeti', engine: 'motor', seed: 'tur tohumu', payout: 'kazanç', total: 'çarpan', cost: 'maliyet' };

export type RowStatus = 'match' | 'mismatch' | 'pending';
/** A server history row: verified when its seed was revealed, otherwise pending (commitment only). */
export async function verifyHistoryRow(row: RemoteHistoryRow): Promise<{ status: RowStatus; result: SlotVerifyResult | null }> {
  const game = slotGame(row.game);
  if (!game) return { status: 'mismatch', result: null };
  if (!row.fair.serverSeed) return { status: 'pending', result: null };
  const result = await verifySlotRound(game, { serverSeed: row.fair.serverSeed, serverSeedHash: row.fair.serverSeedHash, clientSeed: row.fair.clientSeed, nonce: row.fair.nonce, betCents: row.betCents, mode: row.mode },
    { engineId: row.engineId, seedHex: row.fair.seedHex, payoutCents: row.payoutCents, totalHundredths: row.totalHundredths, costCents: row.costCents });
  return { status: result.ok ? 'match' : 'mismatch', result };
}

/** A public replay: fully verified once its server seed is public; before that only engine consistency is known. */
export async function verifyReplay(replay: RemoteReplay): Promise<{ status: RowStatus; result: SlotVerifyResult | null }> {
  if (!replay.fair.serverSeed || !replay.fair.clientSeed) return { status: 'pending', result: null };
  const game = SLOT_GAMES[replay.game]!;
  const result = await verifySlotRound(game, { serverSeed: replay.fair.serverSeed, serverSeedHash: replay.fair.serverSeedHash, clientSeed: replay.fair.clientSeed, nonce: replay.fair.nonce, betCents: replay.betCents, mode: replay.mode },
    { engineId: replay.engineId, seedHex: replay.fair.seedHex, payoutCents: replay.payoutCents, totalHundredths: replay.totalHundredths, costCents: replay.costCents });
  return { status: result.ok ? 'match' : 'mismatch', result };
}

/* ---------------------------------------------------------------- step list for the replay player */
export interface ReplayCell { id: number; symbol: string; multiplier?: number; /** Ebru stain multiplier under the cell (free spins). */ stain?: number }
export interface ReplayFrame { spin: number; kind: 'base' | 'free'; step: number; steps: number; grid: ReplayCell[][]; winIds: number[]; stepHundredths: number; spinWinHundredths: number; totalAfterHundredths: number; last: boolean }
type SpinLike = { kind: 'base' | 'free'; steps: { grid: ReplayCell[][]; wins: { cells: number[] }[]; stepHundredths: number }[]; winHundredths: number; totalHundredthsAfter: number };
/** Every step of every spin in play order (Candy Cascade and Tarhun share the spin/step/grid shape; Ebru has typed steps). */
export function replayFrames(round: SlotRoundSummary): ReplayFrame[] {
  const spins = (round as unknown as { spins?: SpinLike[] }).spins;
  if (!Array.isArray(spins)) return [];
  if (round.engine === EBRU_ENGINE_ID) return ebruFrames(round as unknown as EbruRound);
  if (round.engine === CEZERI_ENGINE_ID) return cezeriFrames(round as unknown as CezeriRound);
  if (round.engine === ASENA_ENGINE_ID) return asenaFrames(round as unknown as AsenaRound);
  const frames: ReplayFrame[] = [];
  spins.forEach((spin, s) => spin.steps.forEach((step, t) => frames.push({
    spin: s, kind: spin.kind, step: t, steps: spin.steps.length, grid: step.grid, winIds: step.wins.flatMap(w => w.cells), stepHundredths: step.stepHundredths,
    spinWinHundredths: spin.winHundredths, totalAfterHundredths: spin.totalHundredthsAfter, last: s === spins.length - 1 && t === spin.steps.length - 1,
  })));
  return frames;
}

/** Ebru (ebru-ink-1): one frame per grid the player saw (deal, bleed, fall, comb pass), the stain field under it, and
 * the clusters that pay on that grid highlighted. Typed steps instead of the tumble spin/step/grid shape. */
function ebruFrames(round: EbruRound): ReplayFrame[] {
  type Raw = { grid: EbruGrid; stains: EbruStains | null; winIds: number[]; stepHundredths: number };
  const frames: ReplayFrame[] = [];
  round.spins.forEach((spin, s) => {
    const raw: Raw[] = [];
    let stains: EbruStains | null = null;
    for (const step of spin.steps) {
      if (step.type === 'drop-in') { stains = step.stains; raw.push({ grid: step.grid, stains, winIds: [], stepHundredths: 0 }); }
      else if (step.type === 'bleed' || step.type === 'fall') raw.push({ grid: step.grid, stains, winIds: [], stepHundredths: 0 });
      else if (step.type === 'comb') { stains = step.stains; raw.push({ grid: step.grid, stains, winIds: [], stepHundredths: 0 }); }
      else if (step.type === 'stains') stains = step.stains;
      else if (step.type === 'clusters' && raw.length) {
        const last = raw[raw.length - 1]!;
        last.winIds = step.clusters.flatMap(c => c.cells.map(cell => cell.id));
        last.stepHundredths = step.stepHundredths;
      }
    }
    raw.forEach((frame, t) => frames.push({
      spin: s, kind: spin.kind, step: t, steps: raw.length,
      grid: frame.grid.map((column, c) => column.map((cell, r) => { const stain = frame.stains?.[c]?.[r] ?? 0; return stain > 0 ? { id: cell.id, symbol: cell.symbol, stain } : { id: cell.id, symbol: cell.symbol }; })),
      winIds: frame.winIds, stepHundredths: frame.stepHundredths, spinWinHundredths: spin.winHundredths, totalAfterHundredths: spin.totalHundredthsAfter,
      last: s === round.spins.length - 1 && t === raw.length - 1,
    }));
  });
  return frames;
}

/** Cezeri (cezeri-gears-1): one frame per rotation (the board after the rings stopped, held slices included) with that
 * rotation's new spoke wins highlighted, plus the final board when the buy guarantee forged vessels. The grid is
 * column = spoke (slice 0..11), row = ring 0..3 (inner on top), so a spoke win reads as a vertical run; id = ring × 12 + slice. */
function cezeriFrames(round: CezeriRound): ReplayFrame[] {
  type Raw = { board: string[][]; winIds: number[]; stepHundredths: number };
  const frames: ReplayFrame[] = [];
  const grid = (board: string[][]): ReplayCell[][] => Array.from({ length: 12 }, (_, slice) => board.map((ring, r) => ({ id: r * 12 + slice, symbol: ring[slice]! })));
  round.spins.forEach((spin, s) => {
    const raw: Raw[] = [];
    for (const step of spin.steps) {
      if (step.type === 'rotate') raw.push({ board: step.board, winIds: [], stepHundredths: 0 });
      else if (step.type === 'win' && raw.length) {
        const last = raw[raw.length - 1]!;
        for (const [r, slice] of step.cells) if (!last.winIds.includes(r * 12 + slice)) last.winIds.push(r * 12 + slice);
        last.stepHundredths += step.winHundredths;
      } else if (step.type === 'scatter' && step.forged.length) raw.push({ board: spin.board, winIds: [], stepHundredths: step.payHundredths });
    }
    raw.forEach((frame, t) => frames.push({
      spin: s, kind: spin.kind, step: t, steps: raw.length, grid: grid(frame.board), winIds: frame.winIds, stepHundredths: frame.stepHundredths,
      spinWinHundredths: spin.winHundredths, totalAfterHundredths: spin.totalHundredthsAfter, last: s === round.spins.length - 1 && t === raw.length - 1,
    }));
  });
  return frames;
}

/** Asena (asena-stars-1): one frame per tumble step (the board at the start of the step: after the previous fall and
 * the wolf walks), its clusters highlighted and the step win (global multiplier applied). Same grid[col][row] shape as
 * the tumble games; wolves, star trails and moons are ordinary cells of the replay grid. */
function asenaFrames(round: AsenaRound): ReplayFrame[] {
  const frames: ReplayFrame[] = [];
  round.spins.forEach((spin, s) => spin.steps.forEach((step, t) => frames.push({
    spin: s, kind: spin.kind, step: t, steps: spin.steps.length,
    grid: step.grid.map(column => column.map(cell => ({ id: cell.id, symbol: cell.symbol }))),
    winIds: step.clusters.flatMap(c => c.cells), stepHundredths: step.winHundredths, spinWinHundredths: spin.winHundredths,
    totalAfterHundredths: spin.totalHundredthsAfter, last: s === round.spins.length - 1 && t === spin.steps.length - 1,
  })));
  return frames;
}
