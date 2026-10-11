import { parsePublicEvent, type PublicEvent } from '@sollish/protocol';

export type ChatState = { cursor: number; events: PublicEvent[] };
export function mergeChatEvent(state: ChatState, value: unknown): { state: ChatState; gap: boolean } {
  const event = parsePublicEvent(value);
  if (!event) return { state, gap: true };
  if (event.seq <= state.cursor) return { state, gap: false };
  if (event.seq !== state.cursor + 1) return { state, gap: true };
  return { state: { cursor: event.seq, events: [...state.events, event].slice(-80) }, gap: false };
}
export function parseChatSnapshot(value: unknown): ChatState | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as { seq?: unknown; events?: unknown; truncated?: unknown };
  if (!Number.isSafeInteger(data.seq) || (data.seq as number) < 0 || !Array.isArray(data.events) || data.events.length > 100) return null;
  const events: PublicEvent[] = [];
  for (const item of data.events) {
    const event = parsePublicEvent(item);
    if (!event || event.seq > (data.seq as number) || (events.length > 0 && event.seq !== events[events.length - 1]!.seq + 1)) return null;
    events.push(event);
  }
  if (events.length && events[events.length - 1]!.seq !== data.seq) return null;
  return { cursor: data.seq as number, events: events.slice(-80) };
}
export function configuredApi(value: string | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol)) return null;
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    return url.toString().replace(/\/$/, '');
  } catch { return null; }
}
export const chatErrorMessage: Record<string, string> = {
  AUTH_REQUIRED: 'Mesaj göndermek için cüzdanınla oturum aç.',
  AUTH_INVALID: 'Oturum doğrulanamadı. Yeniden giriş yap.',
  AUTH_EXPIRED: 'Oturum süresi doldu. Yeniden giriş yap.',
  RATE_LIMITED: 'Çok hızlı mesaj gönderiyorsun. Biraz bekleyip tekrar dene.',
  CHAT_INELIGIBLE: 'Mesaj için son 60 dakikadaki bahis şartı sağlanmıyor.',
  CHAT_UNAVAILABLE: 'Chat şu an kullanılamıyor.',
  SERVICE_UNAVAILABLE: 'Chat servisine ulaşılamıyor.',
  MESSAGE_TOO_LARGE: 'Mesaj en fazla 500 karakter olabilir.',
  INVALID_MESSAGE: 'Mesaj geçerli değil.',
};
