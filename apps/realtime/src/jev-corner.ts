/** Server-only TypeSafe Jev call for Contact 5 corner plans. The key comes from the Worker secret
 * TYPESAFE_API_KEY, goes only to the pinned endpoint in the Authorization header, never follows a
 * redirect and is never logged, stored or returned. Every failure is a short code; the arena then
 * commits the deterministic fallback plan. One call answers both corners (six Choice questions).
 */
import { jevCornerRequest, parseJevCornerAnswer, type CornerObservation, type JevCornerAnswer } from '@sollish/protocol';

export const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_DEADLINE_MS = 1500, JEV_MAX_RESPONSE_BYTES = 32_768;
export type JevFailure = 'DISABLED' | 'TIMEOUT' | 'AUTH_REJECTED' | 'PROVIDER_RATE_LIMITED' | 'HTTP_ERROR' | 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'RESPONSE_TOO_LARGE' | 'REDIRECT_REJECTED' | 'BUDGET_EXHAUSTED';
export type JevResult = { ok: true; answer: JevCornerAnswer; elapsedMs: number } | { ok: false; code: JevFailure; elapsedMs: number };
export const validKey = (key: unknown): key is string => typeof key === 'string' && key.length >= 8 && key.length <= 4096 && /^[\x21-\x7E]+$/.test(key);

class Fail extends Error { constructor(readonly code: JevFailure) { super(code); } }

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > JEV_MAX_RESPONSE_BYTES)) throw new Fail('RESPONSE_TOO_LARGE');
  if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new Fail('INVALID_RESPONSE');
  const reader = response.body.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new Fail('TIMEOUT');
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > JEV_MAX_RESPONSE_BYTES) { void reader.cancel().catch(() => {}); throw new Fail('RESPONSE_TOO_LARGE'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); } catch { throw new Fail('INVALID_RESPONSE'); }
}

export async function askJevCorner(observation: CornerObservation, { key, fetchImpl = fetch, timeoutMs = JEV_DEADLINE_MS, now = () => Date.now() }: { key: string | undefined; fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => number }): Promise<JevResult> {
  const started = now();
  if (!validKey(key)) return { ok: false, code: 'DISABLED', elapsedMs: 0 };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Fail('TIMEOUT')); }, timeoutMs); });
  const work = async () => {
    const response = await fetchImpl(TYPESAFE_ENDPOINT, { method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(jevCornerRequest(observation)) });
    if ((response.type as string) === 'opaqueredirect' || (response.status >= 300 && response.status < 400) || response.redirected || (response.url && response.url !== TYPESAFE_ENDPOINT)) { void response.body?.cancel().catch(() => {}); throw new Fail('REDIRECT_REJECTED'); }
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Fail(response.status === 401 || response.status === 403 ? 'AUTH_REJECTED' : response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'HTTP_ERROR'); }
    const answer = parseJevCornerAnswer(await boundedJson(response, controller.signal));
    if (!answer) throw new Fail('INVALID_RESPONSE');
    return answer;
  };
  try { const answer = await Promise.race([work(), deadline]); return { ok: true, answer, elapsedMs: now() - started }; }
  catch (error) { return { ok: false, code: error instanceof Fail ? error.code : controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', elapsedMs: now() - started }; }
  finally { if (timer !== null) clearTimeout(timer); controller.abort(); }
}
