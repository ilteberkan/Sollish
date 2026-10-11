'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { chatText, MAX_SERVER_FRAME_BYTES, type PublicEvent } from '@sollish/protocol';
import { configuredApi, mergeChatEvent, parseChatSnapshot, chatErrorMessage, type ChatState } from '@/lib/chat';
import { shortAddress } from '@/lib/demo';
import { assertWalletContext, type ConnectedWallet } from '@/lib/wallet';
import { Icon } from './icons';
import { useProduct } from './providers';

const api = configuredApi(process.env.NEXT_PUBLIC_API_URL);
const authConfigured = !!configuredApi(process.env.NEXT_PUBLIC_SUPABASE_URL) && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export function ChatPanel({ onClose, openWallet }: { onClose: () => void; openWallet: () => void }) {
  const inputId = useId();
  const { wallet, activeDemo } = useProduct();
  const [feed, setFeed] = useState<ChatState>({ cursor: 0, events: [] });
  const feedRef = useRef(feed);
  const [connection, setConnection] = useState<'offline' | 'connecting' | 'connected'>('offline');
  const [loginBusy, setLoginBusy] = useState(false);
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const [session, setSession] = useState<{ accessToken: string; expiresAt: number; wallet: ConnectedWallet } | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const [retry, setRetry] = useState(0);
  const mounted = useRef(true);
  const currentWallet = useRef(wallet);
  currentWallet.current = wallet;
  const loginAttempt = useRef(0);
  const applyFeed = (next: ChatState) => { feedRef.current = next; setFeed(next); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!api) return;
    const abort = new AbortController();
    fetch(`${api}/v1/chat/history?after=0`, { signal: abort.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Unavailable');
      const text = await response.text();
      if (text.length > 1_000_000) throw new Error('Oversized history');
      const snapshot = parseChatSnapshot(JSON.parse(text));
      if (!snapshot) throw new Error('Invalid history');
      if (!abort.signal.aborted && snapshot.cursor >= feedRef.current.cursor) applyFeed(snapshot);
    }).catch(() => { if (!abort.signal.aborted) setError('Chat geçmişine ulaşılamıyor.'); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    loginAttempt.current++; setLoginBusy(false); setSession(null); setPending(null); pendingRef.current = null;
  }, [wallet]);
  useEffect(() => {
    if (!api || !session || session.wallet !== wallet || session.expiresAt <= Date.now()) return;
    const url = new URL(`${api}/v1/rooms/lobby`); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('after', String(feedRef.current.cursor));
    setConnection('connecting');
    const ws = new WebSocket(url);
    socket.current = ws;
    let closed = false;
    const expiry = setTimeout(() => { setSession(null); setError('Oturum süresi doldu. Yeniden giriş yap.'); ws.close(); }, Math.min(2_147_483_647, Math.max(0, session.expiresAt - Date.now())));
    const heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ v: 1, type: 'ping' })); }, 25000);
    ws.onopen = () => { if (closed || currentWallet.current !== session.wallet) { ws.close(); return; } ws.send(JSON.stringify({ v: 1, type: 'auth', access_token: session.accessToken })); };
    ws.onmessage = event => {
      if (closed || currentWallet.current !== session.wallet) return;
      if (typeof event.data !== 'string' || new TextEncoder().encode(event.data).length > MAX_SERVER_FRAME_BYTES) { ws.close(); return; }
      let frame: Record<string, unknown>;
      try { frame = JSON.parse(event.data); } catch { ws.close(); return; }
      if (!frame || typeof frame !== 'object' || frame.v !== 1) { ws.close(); return; }
      if (frame.type === 'hello') {
        if (frame.wallet !== session.wallet.address || frame.stream !== 'lobby') { ws.close(); setSession(null); return; }
        setConnection('connected'); setError('');
      } else if (frame.type === 'snapshot') {
        const snapshot = parseChatSnapshot(frame);
        if (!snapshot || frame.stream !== 'lobby') { ws.close(); return; }
        if (snapshot.cursor >= feedRef.current.cursor) applyFeed(snapshot);
      } else if (frame.type === 'event') {
        const merged = mergeChatEvent(feedRef.current, frame.event);
        if (merged.gap) { ws.send(JSON.stringify({ v: 1, type: 'resume', after: feedRef.current.cursor })); }
        else applyFeed(merged.state);
      } else if (frame.type === 'chat.accepted' && frame.client_id === pendingRef.current) {
        setPending(null); pendingRef.current = null; setBody('');
      } else if (frame.type === 'error') {
        const code = typeof frame.code === 'string' ? frame.code : '';
        setError(chatErrorMessage[code] ?? 'Chat isteği tamamlanamadı.');
        setPending(null); pendingRef.current = null;
        if (code.startsWith('AUTH_')) setSession(null);
      }
    };
    ws.onerror = () => { if (!closed) setError('Chat bağlantısı kurulamadı.'); };
    ws.onclose = () => { if (!closed) { setConnection('offline'); if (pendingRef.current) setError('Mesajın durumu belirsiz. Yeniden bağlanıp geçmişi kontrol et.'); setPending(null); pendingRef.current = null; } };
    return () => { closed = true; clearTimeout(expiry); clearInterval(heartbeat); ws.close(); socket.current = null; setConnection('offline'); };
  }, [session, wallet, retry]);
  async function login() {
    if (!wallet) { openWallet(); return; }
    if (!api || !authConfigured || loginBusy) return;
    setLoginBusy(true); setError('');
    const selected = wallet, attempt = ++loginAttempt.current;
    const requireContext = () => { assertWalletContext(selected, currentWallet.current, mounted.current); if (attempt !== loginAttempt.current) throw new Error('WALLET_CHANGED'); };
    try {
      const { signInToChat } = await import('@/lib/chat-auth');
      requireContext();
      const result = await signInToChat(selected, requireContext);
      requireContext(); setSession({ ...result, wallet: selected });
    } catch { if (mounted.current && currentWallet.current === selected && attempt === loginAttempt.current) setError('Chat girişi tamamlanmadı. Cüzdanın mesaj imzalama desteğini ve giriş onayını kontrol et.'); }
    finally { if (mounted.current && attempt === loginAttempt.current) setLoginBusy(false); }
  }
  function send() {
    if (!session || session.wallet !== currentWallet.current || pendingRef.current || connection !== 'connected' || socket.current?.readyState !== WebSocket.OPEN) return;
    const text = body.trim();
    if (!chatText(text)) { setError('1–500 karakter arasında bir mesaj yaz.'); return; }
    const id = crypto.randomUUID(); pendingRef.current = id; setPending(id); setError('');
    socket.current.send(JSON.stringify({ v: 1, type: 'chat.send', client_id: id, body: text }));
  }
  const messages = feed.events.filter((event): event is PublicEvent & { kind: 'chat.message' } => event.kind === 'chat.message');
  return <div className="chat-panel"><div className="chat-heading"><div><Icon name="chat" size={18}/><h2>Topluluk</h2></div><button className="icon-button" aria-label="Chat panelini kapat" onClick={onClose}><Icon name="close" size={18}/></button></div><section className="airdrop-preview" aria-label="Saatlik airdrop"><div className="airdrop-title"><span>Saatlik airdrop</span><Icon name="gift" size={20}/></div><h3>Katılımını kontrol et.</h3><p>Saatlik dönemi, koşulları ve doğrulanan haklarını ödüller ekranından görüntüle. Demo oyunları hak oluşturmaz.</p><Link href="/rewards" aria-disabled={activeDemo} onClick={event => { if (activeDemo) event.preventDefault(); }}>Ödül detayları<Icon name="chevron" size={13}/></Link></section><div className="chat-channel"><strong>Genel sohbet</strong><span><span className={`status-dot ${connection === 'connected' ? 'running' : ''}`}/>{connection === 'connected' ? 'Bağlı' : connection === 'connecting' ? 'Bağlanıyor' : 'Çevrimdışı'}</span></div><div className="chat-messages" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Sohbet mesajları">{messages.length ? messages.map(event => <article className="chat-message" key={event.id}><div className="chat-message-header"><strong title={event.payload.wallet}>{shortAddress(event.payload.wallet)}</strong><time dateTime={event.payload.createdAt}>{new Date(event.payload.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</time></div><p>{event.payload.body}</p></article>) : <div className="chat-empty"><Icon name="chat" size={31}/><h3>{api ? 'Henüz bir mesaj yok.' : 'Sohbet yakında burada.'}</h3><p>{api ? 'Doğrulanan topluluk mesajları bu alanda görünür.' : 'Chat bağlantısı yapılandırılmadı. Açıldığında topluluğa cüzdanınla katılabilirsin.'}</p></div>}</div><div className="chat-composer"><form onSubmit={event => { event.preventDefault(); send(); }}><label className="sr-only" htmlFor={inputId}>Sohbet mesajın</label><div className="chat-input"><textarea id={inputId} placeholder={connection === 'connected' ? 'Bir mesaj yaz…' : 'Sohbete katıl…'} value={body} onChange={event => setBody(event.target.value)} maxLength={500} disabled={connection !== 'connected' || !!pending} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }}/><button type="submit" aria-label="Mesajı gönder" disabled={connection !== 'connected' || !!pending || !body.trim()}><Icon name="arrow" size={18}/></button></div></form>{connection !== 'connected' && <button className="button secondary full-width" disabled={!api || !authConfigured || loginBusy || connection === 'connecting'} onClick={session ? () => setRetry(value => value + 1) : login}>{loginBusy ? 'İmza bekleniyor…' : connection === 'connecting' ? 'Bağlanıyor…' : session ? 'Yeniden bağlan' : wallet ? 'Chat için imzayla giriş' : 'Cüzdanla katıl'}</button>}{error && <p className="form-error" role="alert">{error}</p>}<p>Mesaj için son 60 dakikadaki minimum bahis şartı doğrulanır. Demo oyunları bu koşula dahil değildir.</p></div></div>;
}
