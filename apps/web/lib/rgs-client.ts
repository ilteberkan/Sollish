/** Where a DEMO slot round comes from (docs/architecture/slot-rgs.md).
 *
 * `local`  — the in-browser DEMO exactly as before: local CSPRNG entropy -> the protocol engine; the providers' DemoLedger
 *            reserves and settles. Practice only, never a security boundary.
 * `remote` — the server-authoritative RGS (apps/realtime /v1/slots). The server draws the seed (commit/reveal), runs the
 *            same engine, debits and credits in one transaction and returns the round; the browser only presents it.
 *            The browser never settles a remote round and never computes a remote balance; it re-runs the engine on the
 *            returned seedHex and refuses to present a round that does not match the server's own step list.
 *
 * Remote is chosen only when NEXT_PUBLIC_API_URL is set AND GET /v1/slots/health answers enabled with the same engine
 * id as this build. The bearer token lives in sessionStorage and only ever travels in the Authorization header.
 */
import {
  SLOT_FAIR_VERSION, SLOT_GAMES, SLOT_HEX64_PATTERN, SLOT_ROUND_ID_PATTERN, SLOT_SEED_HEX_PATTERN, cascadeSeedFromEntropy, ebruSeedFromEntropy, isClientSeed, isSlotNonce,
  playCascade2Round, playEbruRound, playStormRound, slotBytesToHex, stormSeedFromEntropy, type Cascade2Round, type CascadeMode, type EbruRound, type SlotRoundSummary, type StormRound,
} from '@sollish/protocol';
import { configuredApi } from './chat';

export type SlotGameId = 'cascade' | 'tarhun' | 'ebru';
export type SlotMode = CascadeMode;
export type RoundOf<G extends SlotGameId> = G extends 'cascade' ? Cascade2Round : G extends 'ebru' ? EbruRound : StormRound;
export const SOURCE_LABELS = Object.freeze({ local: 'Yerel demo', remote: 'Sunucu doğrulamalı' } as const);

/* ---------------------------------------------------------------- local (unchanged behaviour) */
export interface LocalRoundSource {
  readonly kind: 'local'; readonly label: typeof SOURCE_LABELS.local;
  /** Synchronous like before: entropy -> engine. Throws when secure randomness is unavailable. */
  resolve<G extends SlotGameId>(game: G, betCents: number, mode: SlotMode): RoundOf<G>;
}
export function createLocalSource(entropy: (words: Uint32Array) => void = words => { crypto.getRandomValues(words); }): LocalRoundSource {
  return Object.freeze({
    kind: 'local' as const, label: SOURCE_LABELS.local,
    resolve<G extends SlotGameId>(game: G, betCents: number, mode: SlotMode): RoundOf<G> {
      const words = new Uint32Array(4);
      entropy(words);
      if (game === 'cascade') return playCascade2Round(cascadeSeedFromEntropy(words), betCents, mode) as RoundOf<G>;
      if (game === 'ebru') return playEbruRound(ebruSeedFromEntropy(words), betCents, mode) as RoundOf<G>;
      return playStormRound(stormSeedFromEntropy(words), betCents, mode) as RoundOf<G>;
    },
  });
}
export const localRoundSource: LocalRoundSource = createLocalSource();

/* ---------------------------------------------------------------- remote wire types */
export interface RemoteFair { version: typeof SLOT_FAIR_VERSION; serverSeedHash: string; clientSeed: string; nonce: number; seedHex: string }
export interface RemoteSignature { alg: 'HMAC-SHA256'; key: 'worker' | 'dev'; value: string }
export interface RemoteReceipt {
  v: 1; roundId: string; game: SlotGameId; engineId: string; mode: SlotMode; betCents: number; costCents: number; payoutCents: number; totalHundredths: number;
  balanceCents: number; at: number; fair: RemoteFair; signature: RemoteSignature;
}
export interface RemotePlay<R = SlotRoundSummary> { receipt: RemoteReceipt; round: R; replayed: boolean }
export interface RemoteSessionState { balanceCents: number; serverSeedHash: string; nonce: number; revealed: { serverSeed: string; serverSeedHash: string; nonces: number; revealedAt: number }[] }
export interface RemoteHistoryRow {
  roundId: string; game: string; engineId: string; mode: string; betCents: number; costCents: number; payoutCents: number; totalHundredths: number; balanceCents: number; at: number;
  fair: { version: string; serverSeedHash: string; clientSeed: string; nonce: number; seedHex: string; serverSeed: string | null };
}
export interface RemoteReplay {
  v: 1; roundId: string; game: SlotGameId; engineId: string; mode: SlotMode; betCents: number; costCents: number; payoutCents: number; totalHundredths: number;
  fair: { version: string; seedHex: string; serverSeedHash: string; nonce: number; serverSeed: string | null; clientSeed: string | null };
  signature: RemoteSignature;
}
export interface RemoteHealth { enabled: boolean; signature: 'worker' | 'dev'; games: { id: string; engineId: string }[] }

export class RgsError extends Error {
  constructor(readonly code: string, readonly status = 0, readonly retryAfterSeconds?: number) { super(code); }
}
export const RGS_ERROR_TEXT: Readonly<Record<string, string>> = Object.freeze({
  INSUFFICIENT_BALANCE: 'Sunucu bakiyesi bu tur için yetersiz.',
  RATE_LIMITED: 'Çok hızlı oynuyorsun; sunucu bir saniye bekletiyor.',
  SESSION_BUSY: 'Önceki istek hâlâ işleniyor.',
  SESSION_EXPIRED: 'Sunucu oturumunun süresi doldu; sayfayı yenile.',
  AUTH_INVALID: 'Sunucu oturumu geçersiz; sayfayı yenile.',
  SESSION_LIMIT: 'Bu oturumun tur sınırı doldu; sayfayı yenile.',
  ROUND_MISMATCH: 'Sunucunun turu motorla uyuşmadı; tur gösterilmedi.',
  NETWORK: 'Sunucuya ulaşılamadı. Tur sonucu sunucuda saklıysa sayfa yenilenince gösterilir.',
  INVALID_BET: 'Bahis sunucuda reddedildi.',
  INVALID_MODE: 'Mod sunucuda reddedildi.',
  SERVICE_UNAVAILABLE: 'Sunucu şu an turu kabul etmiyor.',
});
export function rgsErrorMessage(error: unknown): string {
  const code = error instanceof RgsError ? error.code : 'NETWORK';
  return RGS_ERROR_TEXT[code] ?? 'Sunucu turu kabul etmedi.';
}

/* ---------------------------------------------------------------- validation of what the server sends */
const int = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const isGameId = (g: unknown): g is SlotGameId => g === 'cascade' || g === 'tarhun' || g === 'ebru';
function parseSignature(s: unknown): RemoteSignature {
  const v = s as Record<string, unknown> | null;
  if (!v || v.alg !== 'HMAC-SHA256' || (v.key !== 'worker' && v.key !== 'dev') || typeof v.value !== 'string' || !SLOT_HEX64_PATTERN.test(v.value)) throw new RgsError('ROUND_MISMATCH');
  return { alg: 'HMAC-SHA256', key: v.key, value: v.value };
}
/** Strict scalar parse of a receipt; the step list is checked separately against the local engine. */
export function parseReceipt(value: unknown, expectGame?: SlotGameId): RemoteReceipt {
  const r = value as Record<string, unknown> | null;
  const f = (r?.fair ?? null) as Record<string, unknown> | null;
  if (!r || !f || r.v !== 1 || typeof r.roundId !== 'string' || !SLOT_ROUND_ID_PATTERN.test(r.roundId) || !isGameId(r.game) || (expectGame && r.game !== expectGame)
    || r.engineId !== SLOT_GAMES[r.game]!.engineId || typeof r.mode !== 'string' || !SLOT_GAMES[r.game]!.modes.includes(r.mode)
    || !int(r.betCents) || !int(r.costCents) || !int(r.payoutCents) || !int(r.totalHundredths) || !int(r.balanceCents) || !int(r.at)
    || f.version !== SLOT_FAIR_VERSION || typeof f.serverSeedHash !== 'string' || !SLOT_HEX64_PATTERN.test(f.serverSeedHash) || !isClientSeed(f.clientSeed) || !isSlotNonce(f.nonce)
    || typeof f.seedHex !== 'string' || !SLOT_SEED_HEX_PATTERN.test(f.seedHex)) throw new RgsError('ROUND_MISMATCH');
  return {
    v: 1, roundId: r.roundId, game: r.game, engineId: r.engineId, mode: r.mode as SlotMode, betCents: r.betCents, costCents: r.costCents, payoutCents: r.payoutCents,
    totalHundredths: r.totalHundredths, balanceCents: r.balanceCents, at: r.at,
    fair: { version: SLOT_FAIR_VERSION, serverSeedHash: f.serverSeedHash, clientSeed: f.clientSeed as string, nonce: f.nonce as number, seedHex: f.seedHex },
    signature: parseSignature(r.signature),
  };
}
/** Re-runs the engine on the server's seedHex; the server's step list must be identical, byte for byte. */
export function verifyServerRound<G extends SlotGameId>(game: G, fields: { engineId: string; seedHex: string; betCents: number; mode: string; costCents: number; payoutCents: number; totalHundredths: number }, serverRound: unknown): RoundOf<G> {
  const definition = SLOT_GAMES[game]!;
  if (fields.engineId !== definition.engineId) throw new RgsError('ROUND_MISMATCH');
  let local: SlotRoundSummary;
  try { local = definition.play(fields.seedHex, fields.betCents, fields.mode); } catch { throw new RgsError('ROUND_MISMATCH'); }
  if (local.payoutCents !== fields.payoutCents || local.totalHundredths !== fields.totalHundredths || local.costCents !== fields.costCents || JSON.stringify(local) !== JSON.stringify(serverRound)) throw new RgsError('ROUND_MISMATCH');
  return local as RoundOf<G>;
}

/* ---------------------------------------------------------------- client */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface RgsClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  storage?: KeyValueStore | null;
  /** Hex of n random bytes (idempotency keys and client seeds). */
  randomHex?: (bytes: number) => string;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}
const TOKEN_KEY = 'sollish:rgs:v1';
const TOKEN_PATTERN = /^[0-9a-f]{96}$/;
const defaultRandomHex = (bytes: number) => slotBytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
/** Waits before retry n (same idempotency key). */
const RETRY_DELAYS_MS = [250, 750, 1500];

export class RgsClient {
  readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly storage: KeyValueStore | null;
  private readonly randomHex: (bytes: number) => string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private token: string | null = null;

  constructor(options: RgsClientOptions) {
    const base = configuredApi(options.baseUrl);
    if (!base) throw new RgsError('NOT_CONFIGURED');
    this.baseUrl = base;
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.storage = options.storage ?? null;
    this.randomHex = options.randomHex ?? defaultRandomHex;
    this.sleep = options.sleep ?? defaultSleep;
    this.timeoutMs = options.timeoutMs ?? 8000;
    try {
      const saved = this.storage?.getItem(TOKEN_KEY);
      const parsed = saved ? JSON.parse(saved) as { base?: unknown; token?: unknown } : null;
      if (parsed && parsed.base === this.baseUrl && typeof parsed.token === 'string' && TOKEN_PATTERN.test(parsed.token)) this.token = parsed.token;
    } catch { /* storage blocked or corrupt: a new session is created */ }
  }
  get hasSession(): boolean { return this.token !== null; }
  /** Drops the token (DEMO credits of that session are abandoned on the server, which expires it). */
  forget(): void { this.token = null; try { this.storage?.removeItem(TOKEN_KEY); } catch { /* blocked */ } }
  private remember(token: string): void { this.token = token; try { this.storage?.setItem(TOKEN_KEY, JSON.stringify({ base: this.baseUrl, token })); } catch { /* memory only */ } }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown, auth = true): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) { if (!this.token) throw new RgsError('AUTH_INVALID', 401); headers.Authorization = `Bearer ${this.token}`; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch { throw new RgsError('NETWORK'); } finally { clearTimeout(timer); }
    let json: Record<string, unknown> = {};
    try { json = await response.json() as Record<string, unknown>; } catch { if (response.ok) throw new RgsError('NETWORK', response.status); }
    if (!response.ok) {
      const code = typeof json.code === 'string' && /^[A-Z_]{3,40}$/.test(json.code) ? json.code : 'SERVICE_UNAVAILABLE';
      if (auth && (code === 'AUTH_INVALID' || code === 'SESSION_EXPIRED')) this.forget();
      throw new RgsError(code, response.status, Number(response.headers.get('Retry-After') ?? '') || undefined);
    }
    return { status: response.status, json, headers: response.headers };
  }

  async health(): Promise<RemoteHealth> {
    const { json } = await this.request('GET', '/v1/slots/health', undefined, false);
    if (json.enabled !== true || !Array.isArray(json.games) || (json.signature !== 'worker' && json.signature !== 'dev')) throw new RgsError('SERVICE_UNAVAILABLE');
    const games = (json.games as unknown[]).flatMap(g => { const o = g as Record<string, unknown>; return typeof o?.id === 'string' && typeof o.engineId === 'string' ? [{ id: o.id, engineId: o.engineId }] : []; });
    return { enabled: true, signature: json.signature, games };
  }
  private parseState(json: Record<string, unknown>): RemoteSessionState {
    if (!int(json.balanceCents) || typeof json.serverSeedHash !== 'string' || !SLOT_HEX64_PATTERN.test(json.serverSeedHash) || !int(json.nonce)) throw new RgsError('SERVICE_UNAVAILABLE');
    const revealed = Array.isArray(json.revealed) ? (json.revealed as Record<string, unknown>[]).flatMap(s => typeof s?.serverSeed === 'string' && SLOT_HEX64_PATTERN.test(s.serverSeed) && typeof s.serverSeedHash === 'string' && int(s.nonces) && int(s.revealedAt) ? [{ serverSeed: s.serverSeed, serverSeedHash: s.serverSeedHash, nonces: s.nonces, revealedAt: s.revealedAt }] : []) : [];
    return { balanceCents: json.balanceCents, serverSeedHash: json.serverSeedHash, nonce: json.nonce, revealed };
  }
  async state(): Promise<RemoteSessionState> { return this.parseState((await this.request('GET', '/v1/slots/session')).json); }
  /** The stored session if the server still knows it, else a new one (fresh DEMO balance). */
  async ensureSession(): Promise<RemoteSessionState> {
    if (this.token) {
      try { return await this.state(); } catch (error) { if (!(error instanceof RgsError) || (error.code !== 'AUTH_INVALID' && error.code !== 'SESSION_EXPIRED')) throw error; }
    }
    const { json } = await this.request('POST', '/v1/slots/session', {}, false);
    if (typeof json.token !== 'string' || !TOKEN_PATTERN.test(json.token)) throw new RgsError('SERVICE_UNAVAILABLE');
    this.remember(json.token);
    return this.parseState({ ...json, revealed: [] });
  }

  /** One round. Network errors, 5xx, SESSION_BUSY and RATE_LIMITED are retried with the SAME idempotency key, so a
   * round the server already committed comes back unchanged instead of being played twice. */
  async play<G extends SlotGameId>(game: G, betCents: number, mode: SlotMode): Promise<RemotePlay<RoundOf<G>>> {
    const body = { betCents, mode, clientSeed: this.randomHex(16), idempotencyKey: this.randomHex(16) };
    for (let attempt = 0; ; attempt++) {
      try {
        const { json, headers } = await this.request('POST', `/v1/slots/${game}/rounds`, body);
        const receipt = parseReceipt(json, game);
        if (receipt.betCents !== betCents || receipt.mode !== mode || receipt.fair.clientSeed !== body.clientSeed) throw new RgsError('ROUND_MISMATCH');
        const round = verifyServerRound(game, { ...receipt, seedHex: receipt.fair.seedHex }, json.round);
        return { receipt, round, replayed: headers.get('Idempotent-Replayed') === 'true' };
      } catch (error) {
        const retryable = error instanceof RgsError && (error.code === 'NETWORK' || error.code === 'SESSION_BUSY' || error.code === 'RATE_LIMITED' || error.status >= 500);
        if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw error;
        const retryAfter = error instanceof RgsError && error.retryAfterSeconds ? Math.min(2000, error.retryAfterSeconds * 1000) : 0;
        await this.sleep(Math.max(RETRY_DELAYS_MS[attempt]!, retryAfter));
      }
    }
  }
  /** Last round of `game` (page reload recovery) and the session's current balance. */
  async last<G extends SlotGameId>(game: G): Promise<{ last: RemotePlay<RoundOf<G>> | null; balanceCents: number }> {
    const { json } = await this.request('GET', `/v1/slots/${game}/rounds/last`);
    if (!int(json.balanceCents)) throw new RgsError('SERVICE_UNAVAILABLE');
    if (json.last === null) return { last: null, balanceCents: json.balanceCents };
    const raw = json.last as Record<string, unknown>;
    const receipt = parseReceipt(raw, game);
    return { last: { receipt, round: verifyServerRound(game, { ...receipt, seedHex: receipt.fair.seedHex }, raw.round), replayed: true }, balanceCents: json.balanceCents };
  }
  async history(): Promise<{ rounds: RemoteHistoryRow[]; balanceCents: number; serverSeedHash: string; nonce: number }> {
    const { json } = await this.request('GET', '/v1/slots/history');
    if (!Array.isArray(json.rounds) || !int(json.balanceCents)) throw new RgsError('SERVICE_UNAVAILABLE');
    const rounds = (json.rounds as RemoteHistoryRow[]).filter(r => r && typeof r.roundId === 'string' && SLOT_ROUND_ID_PATTERN.test(r.roundId) && r.fair && typeof r.fair.seedHex === 'string');
    return { rounds, balanceCents: json.balanceCents, serverSeedHash: String(json.serverSeedHash ?? ''), nonce: Number(json.nonce ?? 0) };
  }
  async rotate(): Promise<{ revealed: { serverSeed: string; serverSeedHash: string; nonces: number }; serverSeedHash: string; nonce: number }> {
    const { json } = await this.request('POST', '/v1/slots/seed/rotate', {});
    const revealed = json.revealed as Record<string, unknown> | undefined;
    if (!revealed || typeof revealed.serverSeed !== 'string' || !SLOT_HEX64_PATTERN.test(revealed.serverSeed) || typeof revealed.serverSeedHash !== 'string' || !int(revealed.nonces) || typeof json.serverSeedHash !== 'string') throw new RgsError('SERVICE_UNAVAILABLE');
    return { revealed: { serverSeed: revealed.serverSeed, serverSeedHash: revealed.serverSeedHash, nonces: revealed.nonces }, serverSeedHash: json.serverSeedHash, nonce: 0 };
  }
  async share(roundId: string): Promise<{ roundId: string; path: string }> {
    if (!SLOT_ROUND_ID_PATTERN.test(roundId)) throw new RgsError('INVALID_MESSAGE');
    const { json } = await this.request('POST', '/v1/slots/replay', { roundId });
    if (json.roundId !== roundId || json.path !== `/replay/${roundId}`) throw new RgsError('SERVICE_UNAVAILABLE');
    return { roundId, path: json.path };
  }
  async resetBalance(): Promise<number> {
    const { json } = await this.request('POST', '/v1/slots/balance/reset', {});
    if (!int(json.balanceCents)) throw new RgsError('SERVICE_UNAVAILABLE');
    return json.balanceCents;
  }
}

/* ---------------------------------------------------------------- public replay */
export function parseReplay(value: unknown): RemoteReplay {
  const r = value as Record<string, unknown> | null, f = (r?.fair ?? null) as Record<string, unknown> | null;
  if (!r || !f || r.v !== 1 || typeof r.roundId !== 'string' || !SLOT_ROUND_ID_PATTERN.test(r.roundId) || !isGameId(r.game) || r.engineId !== SLOT_GAMES[r.game]!.engineId
    || typeof r.mode !== 'string' || !SLOT_GAMES[r.game]!.modes.includes(r.mode) || !int(r.betCents) || !int(r.costCents) || !int(r.payoutCents) || !int(r.totalHundredths)
    || typeof f.seedHex !== 'string' || !SLOT_SEED_HEX_PATTERN.test(f.seedHex) || typeof f.serverSeedHash !== 'string' || !SLOT_HEX64_PATTERN.test(f.serverSeedHash) || !isSlotNonce(f.nonce)
    || !(f.serverSeed === null || (typeof f.serverSeed === 'string' && SLOT_HEX64_PATTERN.test(f.serverSeed))) || !(f.clientSeed === null || isClientSeed(f.clientSeed))) throw new RgsError('ROUND_MISMATCH');
  return {
    v: 1, roundId: r.roundId, game: r.game, engineId: r.engineId, mode: r.mode as SlotMode, betCents: r.betCents, costCents: r.costCents, payoutCents: r.payoutCents, totalHundredths: r.totalHundredths,
    fair: { version: String(f.version), seedHex: f.seedHex, serverSeedHash: f.serverSeedHash, nonce: f.nonce as number, serverSeed: f.serverSeed as string | null, clientSeed: f.clientSeed as string | null },
    signature: parseSignature(r.signature),
  };
}
/** Public, ledger-free: the signed record plus the locally recomputed round (must equal the server's). */
export async function fetchReplay(baseUrl: string, id: string, fetcher: typeof fetch = (i, n) => fetch(i, n)): Promise<{ replay: RemoteReplay; round: SlotRoundSummary }> {
  const base = configuredApi(baseUrl);
  if (!base) throw new RgsError('NOT_CONFIGURED');
  if (!SLOT_ROUND_ID_PATTERN.test(id)) throw new RgsError('NOT_FOUND', 404);
  let response: Response;
  try { response = await fetcher(`${base}/v1/slots/replay/${id}`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }); } catch { throw new RgsError('NETWORK'); }
  let json: Record<string, unknown> = {};
  try { json = await response.json() as Record<string, unknown>; } catch { /* below */ }
  if (!response.ok) throw new RgsError(typeof json.code === 'string' ? json.code : 'SERVICE_UNAVAILABLE', response.status);
  const replay = parseReplay(json.replay);
  if (replay.roundId !== id) throw new RgsError('ROUND_MISMATCH');
  return { replay, round: verifyServerRound(replay.game, { ...replay, seedHex: replay.fair.seedHex }, json.round) };
}

/* ---------------------------------------------------------------- selection */
export type SelectedSource =
  | { kind: 'local'; source: LocalRoundSource; reason: 'unconfigured' | 'unreachable' | 'disabled' | 'engine-mismatch' | 'session-failed' }
  | { kind: 'remote'; source: RemoteRoundSource; balanceCents: number };
export interface RemoteRoundSource { readonly kind: 'remote'; readonly label: typeof SOURCE_LABELS.remote; readonly client: RgsClient }
export type RoundSource = LocalRoundSource | RemoteRoundSource;

export async function selectRoundSource(game: SlotGameId, options: { apiUrl?: string; fetch?: typeof fetch; storage?: KeyValueStore | null; local?: LocalRoundSource; healthTimeoutMs?: number } = {}): Promise<SelectedSource> {
  const local = options.local ?? localRoundSource;
  const base = configuredApi(options.apiUrl);
  if (!base) return { kind: 'local', source: local, reason: 'unconfigured' };
  const client = new RgsClient({ baseUrl: base, fetch: options.fetch, storage: options.storage ?? null, timeoutMs: options.healthTimeoutMs ?? 2500 });
  let health: RemoteHealth;
  try { health = await client.health(); } catch (error) { return { kind: 'local', source: local, reason: error instanceof RgsError && error.code === 'SERVICE_UNAVAILABLE' ? 'disabled' : 'unreachable' }; }
  if (!health.games.some(g => g.id === game && g.engineId === SLOT_GAMES[game]!.engineId)) return { kind: 'local', source: local, reason: 'engine-mismatch' };
  const playing = new RgsClient({ baseUrl: base, fetch: options.fetch, storage: options.storage ?? null });
  try {
    const state = await playing.ensureSession();
    return { kind: 'remote', source: Object.freeze({ kind: 'remote' as const, label: SOURCE_LABELS.remote, client: playing }), balanceCents: state.balanceCents };
  } catch { return { kind: 'local', source: local, reason: 'session-failed' }; }
}

/* ---------------------------------------------------------------- presentation bookkeeping */
const shownKey = (game: SlotGameId) => `sollish:rgs:shown:${game}`;
/** Remembers that a remote round finished presenting, so a reload does not show it again. */
export function markRoundShown(game: SlotGameId, roundId: string, storage: KeyValueStore | null = safeSessionStorage()): void {
  try { storage?.setItem(shownKey(game), roundId); } catch { /* best effort */ }
}
export function lastShownRound(game: SlotGameId, storage: KeyValueStore | null = safeSessionStorage()): string | null {
  try { return storage?.getItem(shownKey(game)) ?? null; } catch { return null; }
}
export function safeSessionStorage(): KeyValueStore | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}
