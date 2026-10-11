'use client';
import { useEffect, useRef, useState } from 'react';
import type { CoinflipResult } from '@sollish/onchain';
import { decodeTracking, encodeTracking, liveDeployment, liveError, parseSol, solLabel, transactionWallet, type LiveTracking } from '@/lib/live';
import { shortAddress, type Side } from '@/lib/demo';
import { AmountControl, SidePicker } from './game-common';
import { useProduct } from './providers';
import { Icon } from './icons';
import { incentiveDeployment, tokenLabel, utcEpochLabel } from '@/lib/tokens';
import { assertWalletContext, type ConnectedWallet } from '@/lib/wallet';
const deployment = liveDeployment();
const rewards = incentiveDeployment('rewards');
export function LiveCoinflip({ onDemo }: { onDemo: () => void }) {
  const { wallet, setWalletOpen } = useProduct();
  const [amount, setAmount] = useState('');
  const [side, setSide] = useState<Side>('heads');
  const [phase, setPhase] = useState<'idle' | 'reviewing' | 'review' | 'signing' | 'confirmed' | 'unknown' | 'settled'>('idle');
  const [quote, setQuote] = useState<bigint | null>(null);
  const [rewardOptIn, setRewardOptIn] = useState(false);
  const [rewardQuote, setRewardQuote] = useState<{ tokenUnits: bigint; epoch: bigint } | null>(null);
  const [error, setError] = useState('');
  const [tracking, setTracking] = useState<LiveTracking | null>(null);
  const [result, setResult] = useState<CoinflipResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const currentWallet = useRef(wallet); currentWallet.current = wallet;
  const previousWallet = useRef(wallet);
  const reviewedWallet = useRef<ConnectedWallet | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (previousWallet.current === wallet) return;
    previousWallet.current = wallet;
    reviewedWallet.current = null;
    if (!tracking && !busy.current) { setQuote(null); setRewardQuote(null); setPhase('idle'); setError(''); }
  }, [wallet, tracking]);
  useEffect(() => {
    if (!deployment || !wallet || tracking || busy.current) return;
    try {
      const raw = sessionStorage.getItem(`sollish:devnet:${deployment.houseAuthority}:${deployment.shardId}:${wallet.address}`);
      const restored = decodeTracking(raw, wallet.address);
      if (restored) { setTracking(restored); setPhase('unknown'); }
      else if (raw) { setPhase('unknown'); setError('Kaydedilmiş bahis takibi doğrulanamadı. Yeni bahis açılmadı; cüzdan geçmişini kontrol et.'); }
    } catch { setPhase('unknown'); setError('İşlem takibi için tarayıcı oturum depolaması gerekiyor. Yeni bahis açılmadı.'); }
  }, [wallet, tracking]);
  function remember(next: LiveTracking, required = false) {
    if (!deployment) return;
    setTracking(next);
    try { sessionStorage.setItem(`sollish:devnet:${deployment.houseAuthority}:${deployment.shardId}:${next.player}`, encodeTracking(next)); }
    catch { if (required) throw new Error('TRACKING_STORAGE_FAILED'); else setError('Takip bilgisi bu sekmede korunuyor; depolama kapalı olduğu için sayfayı yenileme.'); }
  }
  const locked = ['reviewing', 'signing', 'confirmed', 'unknown'].includes(phase) || !!tracking;
  async function review() {
    if (!deployment || !wallet || busy.current || tracking || phase !== 'idle') return;
    const lamports = parseSol(amount);
    if (!lamports) { setError('SOL miktarını en çok 9 ondalıkla gir.'); return; }
    busy.current = true; setPhase('reviewing'); setError('');
    const reviewed = wallet;
    const player = reviewed.address;
    try {
      transactionWallet(wallet);
      const sdk = await import('@sollish/onchain');
      const prepared = await sdk.prepareCoinflip({ deployment: rewardOptIn && rewards ? { ...deployment, tokenMint: rewards.tokenMint } : deployment, player, amountLamports: lamports, side: side === 'heads' ? 0 : 1, ...(rewardOptIn && rewards ? { rewardPhaseId: rewards.rewardPhaseId } : {}) });
      assertWalletContext(reviewed, currentWallet.current, mounted.current);
      reviewedWallet.current = reviewed;
      setQuote(prepared.expectedGrossLamports); setRewardQuote(prepared.rewardQuote); setPhase('review');
    } catch (cause) { if (mounted.current) { setError(liveError[cause instanceof Error ? cause.message : ''] ?? 'Bahis ön kontrolü tamamlanamadı. Henüz işlem imzalanmadı.'); setPhase('idle'); } }
    finally { busy.current = false; }
  }
  async function send() {
    if (!deployment || !wallet || busy.current || phase !== 'review' || tracking || quote === null) return;
    const lamports = parseSol(amount); if (!lamports) return;
    busy.current = true; setPhase('signing'); setError('');
    const player = wallet.address;
    const sendingWallet = wallet;
    const requireContext = () => assertWalletContext(sendingWallet, currentWallet.current, mounted.current);
    let sdk: typeof import('@sollish/onchain') | undefined;
    let prepared = false;
    try {
      assertWalletContext(reviewedWallet.current, sendingWallet, mounted.current);
      sdk = await import('@sollish/onchain');
      const sent = await sdk.sendCoinflip({ deployment: rewardOptIn && rewards ? { ...deployment, tokenMint: rewards.tokenMint } : deployment, wallet: transactionWallet(sendingWallet, requireContext), amountLamports: lamports, side: side === 'heads' ? 0 : 1, ...(rewardOptIn && rewards ? { rewardPhaseId: rewards.rewardPhaseId } : {}),
        onPrepared: ticket => { requireContext(); remember({ player, id: ticket.id, betAddress: ticket.betAddress }, true); prepared = true; },
      });
      if (mounted.current) { remember({ player, id: sent.id, betAddress: sent.betAddress, signature: sent.signature }); setPhase('confirmed'); }
    } catch (cause) {
      if (!mounted.current) return;
      if (sdk && (cause instanceof sdk.SubmissionUnknownError || cause instanceof sdk.WalletSubmissionUnknownError)) {
        remember({ player, id: cause.id, betAddress: cause.betAddress, ...('signature' in cause ? { signature: cause.signature } : {}) });
        setPhase('unknown'); setError('İşlemin sonucu henüz bilinmiyor. Aynı bahis izleniyor; yeni bahis gönderilmez.');
      } else {
        const code = cause instanceof Error ? cause.message : '';
        const storageFailedBeforeWallet = code === 'TRACKING_STORAGE_FAILED';
        if (storageFailedBeforeWallet) setTracking(null);
        setPhase(prepared && !storageFailedBeforeWallet ? 'unknown' : 'idle'); setQuote(null);
        setError(liveError[code] ?? (prepared ? 'Gönderim durumu doğrulanamadı. Yeni bahis göndermeden aynı hesabı kontrol et.' : 'Ön kontrol tamamlanmadı. Cüzdan işlemi başlatılmadı.'));
      }
    } finally { busy.current = false; }
  }
  async function refresh() {
    if (!deployment || !tracking || refreshing) return;
    setRefreshing(true);
    try {
      const sdk = await import('@sollish/onchain');
      const latest = await sdk.readCoinflip(deployment, tracking.player, tracking.id);
      if (latest && latest.betAddress !== tracking.betAddress) throw new Error('TRACKING_ACCOUNT_MISMATCH');
      if (mounted.current) { setResult(latest); if (latest?.status === 'settled') { setPhase('settled'); setError(''); } else if (!latest) setError('Bu bahis için kesinleşmiş hesap bulunamadı. Bu, kayıp, kazanç veya güvenli yeniden gönderim anlamına gelmez.'); else setError(''); }
    } catch { if (mounted.current) setError('Kesinleşmiş sonuç okunamadı. Aynı bahis tekrar sorgulanabilir.'); }
    finally { if (mounted.current) setRefreshing(false); }
  }
  function nextBet() {
    if (!deployment || !tracking || phase !== 'settled' || result?.status !== 'settled') return;
    try { sessionStorage.removeItem(`sollish:devnet:${deployment.houseAuthority}:${deployment.shardId}:${tracking.player}`); }
    catch { setError('Tamamlanan bahis kaydı temizlenemedi. Yeni bahis açılmadı.'); return; }
    setTracking(null); setResult(null); setQuote(null); setRewardQuote(null); setAmount(''); setPhase('idle'); setError('');
  }
  return <><section className="game-table live-coinflip"><div className="table-topline"><span className="table-status"><span className="status-dot"/>Solana devnet</span><span className="small muted">Test SOL</span></div>{!deployment ? <div className="live-gate"><span className="stage-lock"><Icon name="lock" size={27}/></span><h2>Canlı Coinflip henüz açık değil.</h2><p>Devnet sözleşmesi ve rezerv doğrulanmadan cüzdanından bahis alınmaz.</p><button className="text-button" onClick={onDemo}>Yerel demoyu dene<Icon name="arrow" size={17}/></button><button className="button secondary" disabled>Canlı bahis kapalı</button></div> : <div className="live-form"><div className="live-network-note"><Icon name="info" size={18}/><p>Yalnız Solana devnet test ağı. Rastgelelik isteği sonuçlanmazsa bahis kilitli kalabilir; otomatik iade veya yeniden çekiliş yoktur.</p></div><SidePicker side={side} setSide={value => { setSide(value); setQuote(null); setPhase('idle'); }} disabled={locked}/><AmountControl amount={amount} setAmount={value => { setAmount(value); setQuote(null); setPhase('idle'); }} disabled={locked} unit="SOL"/>{rewards && <label className="reward-opt-in"><input type="checkbox" checked={rewardOptIn} disabled={locked} onChange={event => { setRewardOptIn(event.target.checked); setQuote(null); setRewardQuote(null); setPhase('idle'); }}/><span>Oyun ödül programına katıl<small>Ek hesap kirası olabilir. Tokenlar ayrıca talep edilir.</small></span></label>}{quote !== null && <dl className="detail-rows"><div><dt>Bahis miktarı</dt><dd>{solLabel(parseSol(amount)!)} test SOL</dd></div><div><dt>Kazanırsan brüt ödeme</dt><dd>{solLabel(quote)} test SOL</dd></div><div><dt>Ağ ücreti ve hesap kirası</dt><dd>Cüzdan onayında ayrıca</dd></div>{rewardQuote && <><div><dt>Beklenen oyun ödül hakkı</dt><dd>{tokenLabel(rewardQuote.tokenUnits)} token</dd></div><div><dt>Katılım dönemi</dt><dd>{utcEpochLabel(rewardQuote.epoch)}</dd></div></>}</dl>}{!tracking && <button className="button primary full-width" onClick={!wallet ? () => setWalletOpen(true) : phase === 'review' ? send : review} disabled={busy.current || phase === 'signing' || phase === 'reviewing' || phase === 'unknown'}>{!wallet ? 'Cüzdan bağla' : phase === 'reviewing' ? 'Sözleşme kontrol ediliyor…' : phase === 'signing' ? 'İmza ve işlem onayı bekleniyor…' : phase === 'review' ? 'Devnet bahsini cüzdanda onayla' : 'Bahsi incele'}</button>}{tracking && <section className="live-tracking" aria-live="polite"><h3>{phase === 'settled' ? 'Sonuç kesinleşti' : phase === 'confirmed' ? 'Bahis kabul edildi' : phase === 'signing' ? 'İşlem onayı bekleniyor' : 'İşlem durumu belirsiz'}</h3><p>{result?.status === 'awaiting-randomness' ? 'Rastgelelik bekleniyor.' : result?.status === 'ready-to-settle' ? 'Sonuç hazır, ödeme işleminin kesinleşmesi bekleniyor.' : result?.status === 'settled' ? `${solLabel(result.payout)} test SOL brüt ödeme kesinleşti.` : 'Gönderim onayı, oyun sonucunun veya ödemenin tamamlandığı anlamına gelmez.'}</p><a className="text-button" href={`https://explorer.solana.com/address/${tracking.betAddress}?cluster=devnet`} target="_blank" rel="noopener noreferrer">Bahis hesabı: {shortAddress(tracking.betAddress)}<Icon name="link" size={16}/></a>{tracking.signature && <a className="text-button" href={`https://explorer.solana.com/tx/${tracking.signature}?cluster=devnet`} target="_blank" rel="noopener noreferrer">Zincir işlemini görüntüle<Icon name="link" size={16}/></a>}<button className="button secondary full-width" onClick={refresh} disabled={refreshing}>{refreshing ? 'Sonuç kontrol ediliyor…' : 'Aynı bahsin sonucunu kontrol et'}</button>{phase === 'settled' && <button className="button primary full-width" onClick={nextBet}>Yeni devnet bahsi</button>}</section>}{error && <p className="form-error" role="alert">{error}</p>}</div>}</section><div className="demo-notice"><Icon name="shield" size={17}/><p>Crash ve Coinflip erişimleri ayrı doğrulanır. Cüzdan bağlantısı tek başına bahis veya ödeme başlatmaz. Gerçek ağa gönderim bu uygulamada kapalıdır.</p></div></>;
}
