'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { IncentivesDeployment, IncentiveAction, IncentiveTicket } from '@sollish/onchain';
import { decodeIncentiveTracking, storageKey, type IncentiveTracking as Tracking } from '@/lib/incentive-tracking';
import { useProduct } from './providers';
import { Icon } from './icons';
import { shortAddress } from '@/lib/demo';
import { liveError, solLabel, transactionWallet } from '@/lib/live';
import { parseTokens, tokenLabel, utcEpochLabel } from '@/lib/tokens';
import { assertWalletContext, type ConnectedWallet } from '@/lib/wallet';

type StakingState = Awaited<ReturnType<typeof import('@sollish/onchain')['readStakingState']>>;
type RewardState = Awaited<ReturnType<typeof import('@sollish/onchain')['readRewardState']>>;
type Request = { action: IncentiveAction; amount?: bigint; epoch?: bigint };
type Operation = 'idle' | 'checking' | 'review' | 'signing' | 'unknown' | 'pending' | 'failed' | 'finalized';
const actionLabels: Record<IncentiveAction, string> = { stake: 'Token stake et', unstake: 'Stake çöz', 'claim-staking': 'Stake ödülünü talep et', 'claim-wager': 'Oyun ödülünü talep et', 'claim-hourly': 'Saatlik ödülü talep et' };
const errors: Record<string, string> = {
  ...liveError,
  NOTHING_TO_CLAIM: 'Bu işlem için talep edilebilir bir miktar yok.',
  HOURLY_NOT_CLAIMABLE: 'Bu saat için talep koşulları sağlanmıyor.',
  POOL_ENDED: 'Bu havuza yeni stake kabulü sona erdi. Pozisyonunu çözebilirsin.',
  INSUFFICIENT_TOKEN_BALANCE: 'Cüzdanındaki token miktarı yeterli değil.',
  INSUFFICIENT_STAKE: 'Çözmek istediğin miktar stake edilen miktarı aşıyor.',
  INSUFFICIENT_TOKEN_RESERVE: 'Ödül rezervi doğrulanamadı. İşlem kapalı tutuldu.',
  POSITION_MISSING: 'Bu cüzdana ait staking pozisyonu bulunamadı.',
  SNAPSHOT_EPOCH_CHANGED: 'Saatlik dönem değişti. Verileri yenileyip tekrar incele.',
};
function useTokenOperation(deployment: IncentivesDeployment, kind: 'stake' | 'rewards', refresh: () => Promise<void>) {
  const { wallet } = useProduct();
  const [operation, setOperation] = useState<Operation>('idle');
  const [error, setError] = useState('');
  const [request, setRequest] = useState<Request | null>(null);
  const [quote, setQuote] = useState<{ action: IncentiveAction; amount: bigint; tokenMint: string; epoch: bigint | null } | null>(null);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const busy = useRef(false);
  const currentWallet = useRef(wallet); currentWallet.current = wallet;
  const previousWallet = useRef(wallet);
  const reviewedWallet = useRef<ConnectedWallet | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (previousWallet.current === wallet) return;
    previousWallet.current = wallet;
    reviewedWallet.current = null;
    if (!tracking && !busy.current) { setRequest(null); setQuote(null); setOperation('idle'); setError(''); }
  }, [wallet, tracking]);
  useEffect(() => {
    if (!wallet || tracking || busy.current) return;
    try {
      const raw = sessionStorage.getItem(storageKey(deployment, wallet.address, kind));
      if (raw) { setTracking(decodeIncentiveTracking(raw, deployment, wallet.address, kind)); setOperation('unknown'); }
    } catch { setOperation('unknown'); setError('Kaydedilmiş işlem takibi okunamadı. Yeni işlem açılmadı; cüzdan geçmişini kontrol et.'); }
  }, [deployment, kind, wallet, tracking]);
  const save = (value: Tracking, required = false) => {
    if (alive.current) setTracking(value);
    try { sessionStorage.setItem(storageKey(deployment, value.ticket.player, kind), JSON.stringify(value)); }
    catch { if (required) throw new Error('TRACKING_STORAGE_FAILED'); else if (alive.current) setError('İşlem takibi bu sekmede. Depolama kapalı olduğu için sayfayı yenileme.'); }
  };
  const prepare = async (next: Request) => {
    if (!wallet || busy.current || tracking || operation === 'unknown') return;
    const player = wallet.address;
    const reviewed = wallet;
    busy.current = true; setOperation('checking'); setError(''); setQuote(null);
    try {
      transactionWallet(wallet);
      const sdk = await import('@sollish/onchain');
      const prepared = await sdk.prepareIncentive({ deployment, player, ...next });
      assertWalletContext(reviewed, currentWallet.current, alive.current);
      reviewedWallet.current = reviewed;
      setRequest(next); setQuote(prepared.quote); setOperation('review');
    } catch (cause) { if (alive.current) { setOperation('idle'); setError(errors[cause instanceof Error ? cause.message : ''] ?? 'İşlem ön kontrolü tamamlanamadı. Cüzdan imzası istenmedi.'); } }
    finally { busy.current = false; }
  };
  const send = async () => {
    if (!wallet || !request || operation !== 'review' || busy.current || tracking) return;
    busy.current = true; setOperation('signing'); setError('');
    const sendingWallet = wallet;
    const requireContext = () => assertWalletContext(sendingWallet, currentWallet.current, alive.current);
    let sdk: typeof import('@sollish/onchain') | undefined;
    let prepared = false;
    try {
      assertWalletContext(reviewedWallet.current, sendingWallet, alive.current);
      sdk = await import('@sollish/onchain');
      const result = await sdk.sendIncentive({ deployment, wallet: transactionWallet(sendingWallet, requireContext), ...request,
        onPrepared: ticket => { requireContext(); save({ ticket, signature: null }, true); prepared = true; },
      });
      save({ ticket: result.ticket, signature: result.signature });
      if (alive.current) { setOperation('finalized'); await refresh(); }
    } catch (cause) {
      if (!alive.current) return;
      if (sdk && cause instanceof sdk.IncentiveSubmissionUnknownError) {
        save({ ticket: cause.ticket, signature: cause.signature }); setOperation('unknown');
        setError('Sonuç belirsiz. Aynı işlem izleniyor; yeniden gönderim yapılmaz.');
      } else {
        const code = cause instanceof Error ? cause.message : '';
        const beforeWallet = code === 'TRACKING_STORAGE_FAILED';
        if (beforeWallet) setTracking(null);
        setOperation(prepared && !beforeWallet ? 'unknown' : 'idle');
        setError(errors[code] ?? (prepared ? 'İşlem durumu doğrulanamadı. Cüzdan geçmişini ve aynı işlem kaydını kontrol et.' : 'Ön kontrol tamamlanmadı. Cüzdan işlemi başlatılmadı.'));
      }
    } finally { busy.current = false; }
  };
  const track = async () => {
    if (!tracking || busy.current) return;
    busy.current = true; setError('');
    try {
      const sdk = await import('@sollish/onchain');
      const status = await sdk.trackIncentive(deployment, tracking.ticket, tracking.signature);
      if (alive.current) { setOperation(status); if (status === 'finalized') await refresh(); }
    } catch { if (alive.current) { setOperation('unknown'); setError('İşlem kesinliği okunamadı. Yeni gönderim yapılmadı.'); } }
    finally { busy.current = false; }
  };
  const reset = () => {
    if (busy.current || !tracking || !['finalized', 'failed'].includes(operation)) return;
    try { sessionStorage.removeItem(storageKey(deployment, tracking.ticket.player, kind)); }
    catch { setError('Takip kaydı temizlenemedi. Yeni işlem açılmadı.'); return; }
    setTracking(null); setQuote(null); setRequest(null); setOperation('idle'); setError('');
  };
  return { operation, error, quote, tracking, prepare, send, track, reset,
    cancel: () => { if (!busy.current && !tracking) { setOperation('idle'); setQuote(null); setRequest(null); } },
    blocked: operation !== 'idle' || tracking !== null,
  };
}
type TokenOperation = ReturnType<typeof useTokenOperation>;
function OperationPanel({ flow }: { flow: TokenOperation }) {
  return <>{flow.operation === 'checking' && <p className="operation-status" role="status">Sözleşme, bakiye ve rezerv kontrol ediliyor…</p>}{flow.operation === 'review' && flow.quote && <section className="token-review" aria-label="İşlem incelemesi"><h3>{actionLabels[flow.quote.action]}</h3><dl className="detail-rows"><div><dt>{flow.quote.action.startsWith('claim') ? 'Hesaplanan talep' : 'Miktar'}</dt><dd>{tokenLabel(flow.quote.amount)} token</dd></div><div><dt>Token mint</dt><dd title={flow.quote.tokenMint}>{shortAddress(flow.quote.tokenMint)}</dd></div><div><dt>Ağ</dt><dd>Solana devnet</dd></div><div><dt>Ağ ücreti / hesap kirası</dt><dd>Cüzdanda ayrıca</dd></div>{flow.quote.epoch !== null && <div><dt>Dönem</dt><dd>{utcEpochLabel(flow.quote.epoch)}</dd></div>}</dl><p>İşlem anındaki zincir durumu yeniden kontrol edilir. Talep miktarı kesinleşene kadar değişebilir.</p><div className="token-review-actions"><button className="button secondary" onClick={flow.cancel}>Vazgeç</button><button className="button primary" onClick={flow.send}>Cüzdanda onayla</button></div></section>}{flow.operation === 'signing' && <p className="operation-status" role="status">Cüzdan onayı ve zincir kesinliği bekleniyor…</p>}{flow.tracking && <section className="token-tracking" aria-live="polite"><h3>{flow.operation === 'finalized' ? 'İşlem kesinleşti' : flow.operation === 'failed' ? 'İşlem başarısız' : flow.operation === 'signing' ? 'İşlem izleniyor' : 'Kesinleşmiş sonuç bekleniyor'}</h3><p>{flow.operation === 'finalized' ? 'İşlem kesinleşti. Güncel pozisyonunu yenileyebilirsin. Gösterilen talep tahmini, ödenen miktarın ayrıca kanıtı değildir.' : flow.operation === 'failed' ? 'Kesinleşmiş zincir kaydı işlemin başarısız olduğunu gösteriyor. Ağ ücreti alınmış olabilir.' : 'İmza veya işlem geçmişi bulunamaması, güvenle yeniden gönderebileceğin anlamına gelmez.'}</p>{flow.tracking.signature && <a className="text-button" href={`https://explorer.solana.com/tx/${flow.tracking.signature}?cluster=devnet`} target="_blank" rel="noopener noreferrer">Zincir işlemini görüntüle<Icon name="link" size={16}/></a>}<button className="button secondary" disabled={flow.operation === 'signing'} onClick={flow.track}>Aynı işlemi kontrol et</button>{['finalized', 'failed'].includes(flow.operation) && <button className="text-button" onClick={flow.reset}>Yeni işlem için forma dön<Icon name="arrow" size={16}/></button>}</section>}{flow.error && <p className="form-error" role="alert">{flow.error}</p>}</>;
}

export function LiveStake({ deployment }: { deployment: IncentivesDeployment }) {
  const { wallet, setWalletOpen } = useProduct();
  const [state, setState] = useState<StakingState | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState('');
  const [amount, setAmount] = useState('');
  const [action, setAction] = useState<'stake' | 'unstake'>('stake');
  const address = useRef(wallet?.address); address.current = wallet?.address;
  const load = useCallback(async () => {
    if (!wallet) return;
    const player = wallet.address; setLoading(true); setReadError('');
    try { const sdk = await import('@sollish/onchain'); const next = await sdk.readStakingState(deployment, player); if (address.current === player) setState(next); }
    catch { if (address.current === player) { setState(null); setReadError('Staking verileri doğrulanamadı. İşlemler kapalı tutuluyor.'); } }
    finally { if (address.current === player) setLoading(false); }
  }, [deployment, wallet]);
  useEffect(() => { setState(null); if (wallet) void load(); }, [wallet, load]);
  const flow = useTokenOperation(deployment, 'stake', load);
  const units = parseTokens(amount);
  const maximum = action === 'stake' ? state?.walletBalance : state?.staked;
  const ended = !!state && state.chainTimestamp >= state.endTs;
  return <div className="live-token-page"><div className="live-token-banner"><Icon name="shield" size={20}/><div><strong>Devnet staking</strong><p>Önceden fonlanan havuz. İşlemler yalnız doğrulanan token ve kendi cüzdanın için hazırlanır.</p></div><span className="mode-badge neutral-badge">Test ağı</span></div>{!wallet ? <div className="token-wallet-gate"><Icon name="wallet" size={30}/><h2>Pozisyonunu cüzdanınla görüntüle.</h2><p>Bağlanmak stake işlemi başlatmaz.</p><button className="button primary" onClick={() => setWalletOpen(true)}>Cüzdan bağla</button></div> : <><div className="section-heading token-section-heading"><h2>Pozisyonun</h2><button className="text-button" onClick={() => void load()} disabled={loading || flow.blocked}>{loading ? 'Okunuyor…' : 'Verileri yenile'}<Icon name="history" size={16}/></button></div>{readError && <p className="form-error" role="alert">{readError}</p>}<div className="live-stake-grid"><section className="live-stake-position"><span>Stake edilen</span><strong className="token-large">{state ? tokenLabel(state.staked) : '—'}<small> token</small></strong><dl className="detail-rows"><div><dt>Cüzdan bakiyesi</dt><dd>{state ? tokenLabel(state.walletBalance) : '—'} token</dd></div><div><dt>Talep edilebilir stake ödülü</dt><dd>{state ? tokenLabel(state.pendingRewards) : '—'} token</dd></div><div><dt>Havuzdaki toplam stake</dt><dd>{state ? tokenLabel(state.totalStaked) : '—'} token</dd></div><div><dt>Fonlanan toplam ödül</dt><dd>{state ? tokenLabel(state.budget) : '—'} token</dd></div><div><dt>Ödül döneminin sonu</dt><dd>{state ? new Date(Number(state.endTs) * 1000).toLocaleString('tr-TR', { timeZone: 'UTC' }) + ' UTC' : '—'}</dd></div></dl><button className="button secondary full-width" disabled={!state || state.pendingRewards === 0n || flow.blocked || loading} onClick={() => void flow.prepare({ action: 'claim-staking' })}>Stake ödülünü incele</button></section><section className="live-stake-controls"><div className="mode-switch" aria-label="Staking işlemi"><button aria-pressed={action === 'stake'} disabled={flow.blocked} onClick={() => setAction('stake')}>Stake et</button><button aria-pressed={action === 'unstake'} disabled={flow.blocked} onClick={() => setAction('unstake')}>Stake çöz</button></div><label htmlFor="stake-amount">Token miktarı</label><div className="amount-input-wrap"><input id="stake-amount" inputMode="decimal" value={amount} placeholder="Miktar gir" disabled={flow.blocked || !state} onChange={event => setAmount(event.target.value)}/><span>Token</span></div><p className="small muted">Kullanılabilir: {maximum !== undefined ? tokenLabel(maximum) : '—'} token</p><button className="button primary full-width" disabled={!state || !units || maximum === undefined || units > maximum || flow.blocked || loading || (action === 'stake' && ended)} onClick={() => { if (units) void flow.prepare({ action, amount: units }); }}>{action === 'stake' && ended ? 'Yeni stake dönemi sona erdi' : action === 'stake' ? 'Stake işlemini incele' : 'Çözme işlemini incele'}</button><p className="small muted">Stake edilen ana para ile ödül bakiyesi ayrı tutulur. Oyunların duraklatılması çözme işlemini kapatmaz.</p></section></div><OperationPanel flow={flow}/>{state && <a className="text-button" target="_blank" rel="noopener noreferrer" href={`https://explorer.solana.com/address/${state.poolAddress}?cluster=devnet`}>Havuz sözleşmesini görüntüle<Icon name="link" size={16}/></a>}</>}<div className="demo-notice"><Icon name="info" size={16}/><p>Sabit getiri veya APY vaat edilmez. Gösterilen değerler son kesinleşmiş zincir okumasına aittir; demo kredileri stake edilemez.</p></div></div>;
}

export function LiveRewards({ deployment }: { deployment: IncentivesDeployment }) {
  const { wallet, setWalletOpen } = useProduct();
  const [state, setState] = useState<RewardState | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState('');
  const [epoch, setEpoch] = useState<bigint | undefined>();
  const address = useRef(wallet?.address); address.current = wallet?.address;
  const load = useCallback(async () => {
    if (!wallet) return;
    const player = wallet.address; setLoading(true); setReadError('');
    try { const sdk = await import('@sollish/onchain'); let next = await sdk.readRewardState(deployment, player, epoch); if (epoch === undefined && next.epoch >= next.endEpoch) next = await sdk.readRewardState(deployment, player, next.endEpoch - 1n); if (address.current === player) setState(next); }
    catch { if (address.current === player) { setState(null); setReadError('Ödül hakları doğrulanamadı. Talep işlemleri kapalı tutuluyor.'); } }
    finally { if (address.current === player) setLoading(false); }
  }, [deployment, epoch, wallet]);
  useEffect(() => { setState(null); if (wallet) void load(); }, [wallet, load]);
  const flow = useTokenOperation(deployment, 'rewards', load);
  return <div className="live-token-page"><div className="live-token-banner"><Icon name="gift" size={22}/><div><strong>Devnet ödül programı</strong><p>Oyun ve saatlik ödüller, fonlanmış dönem hesaplarından okunur.</p></div><span className="mode-badge neutral-badge">Test ağı</span></div>{!wallet ? <div className="token-wallet-gate"><Icon name="wallet" size={30}/><h2>Haklarını cüzdanınla görüntüle.</h2><p>Demo oyunları token hakkı oluşturmaz.</p><button className="button primary" onClick={() => setWalletOpen(true)}>Cüzdan bağla</button></div> : <><div className="section-heading token-section-heading"><h2>Oyun ödüllerin</h2><button className="text-button" disabled={loading || flow.blocked} onClick={() => void load()}>{loading ? 'Okunuyor…' : 'Verileri yenile'}<Icon name="history" size={16}/></button></div>{readError && <p className="form-error" role="alert">{readError}</p>}<section className="live-wager-rewards"><div><span>Talep edilebilir oyun ödülü</span><strong className="token-large">{state ? tokenLabel(state.wagerPending) : '—'}<small> token</small></strong><p>Yalnız ödül programına dahil edilerek kabul edilen bahisler.</p></div><button className="button primary" disabled={!state || state.wagerPending === 0n || flow.blocked || loading} onClick={() => void flow.prepare({ action: 'claim-wager' })}>Oyun ödülünü incele</button></section><section className="live-hourly"><div className="section-heading"><h2>Saatlik airdrop</h2><Icon name="clock" size={20}/></div><div className="epoch-picker"><button className="icon-button" aria-label="Önceki saat" disabled={!state || state.epoch <= state.startEpoch || flow.blocked || loading} onClick={() => { if (state) setEpoch(state.epoch - 1n); }}><Icon name="chevron" style={{ transform: 'rotate(180deg)' }}/></button><strong>{state ? utcEpochLabel(state.epoch) : 'Dönem okunmadı'}</strong><button className="icon-button" aria-label="Sonraki saat" disabled={!state || state.epoch + 1n >= state.currentEpoch || state.epoch + 1n >= state.endEpoch || flow.blocked || loading} onClick={() => { if (state) setEpoch(state.epoch + 1n); }}><Icon name="chevron"/></button></div><dl className="detail-rows"><div><dt>Talep edilebilir saatlik pay</dt><dd>{state ? tokenLabel(state.hourlyClaimable) : '—'} token</dd></div><div><dt>Uygunluğun</dt><dd>{state ? state.recordExists ? state.qualified ? 'Asgari bahis sağlandı' : 'Asgari bahis sağlanmadı' : 'Açık katılım kaydı yok' : 'Doğrulanmadı'}</dd></div><div><dt>Dönemdeki bahis hacmin</dt><dd>{state ? solLabel(state.playerWager) : '—'} test SOL</dd></div><div><dt>Uygun toplam bahis hacmi</dt><dd>{state ? solLabel(state.qualifiedWagerTotal) : '—'} test SOL</dd></div><div><dt>Minimum bahis</dt><dd>{state ? solLabel(state.minimumWager) : '—'} test SOL</dd></div><div><dt>Saatlik dağıtım bütçesi</dt><dd>{state ? tokenLabel(state.hourlyBudget) : '—'} token</dd></div></dl><p>Pay, eşiği geçen cüzdanların bahis hacmine göre hesaplanır. Dönemler UTC saatleridir; chat’in kayan son 60 dakika şartından farklıdır. Açık kayıt bulunmaması ödeme yapıldığını kanıtlamaz.</p><button className="button secondary full-width" disabled={!state || !state.qualified || !state.recordExists || !state.epochFinished || flow.blocked || loading} onClick={() => { if (state) void flow.prepare({ action: 'claim-hourly', epoch: state.epoch }); }}>{state?.recordExists && state.qualified && state.hourlyClaimable === 0n ? 'Sıfır paylı kaydı kapatmayı incele' : 'Saatlik ödülünü incele'}</button></section><OperationPanel flow={flow}/>{state && <a className="text-button" target="_blank" rel="noopener noreferrer" href={`https://explorer.solana.com/address/${state.phaseAddress}?cluster=devnet`}>Ödül dönemini zincirde görüntüle<Icon name="link" size={16}/></a>}</>}<div className="demo-notice"><Icon name="info" size={16}/><p>Ödül koşulları faz boyunca sabittir. Token değeri veya getiri garantisi yoktur; demo oyunları ödül programına dahil değildir.</p></div></div>;
}
