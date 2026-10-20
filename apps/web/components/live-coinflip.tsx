'use client';
import { useEffect, useRef, useState } from 'react';
import type { CoinflipResult } from '@sollish/onchain';
import { decodeTracking, encodeTracking, liveDeployment, liveError, parseSol, transactionWallet, type LiveTracking } from '@/lib/live';
import { solLabelIn } from '@/lib/sol-label';
import { useLocale, useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/catalog';
import { shortAddress, type Side } from '@/lib/demo';
import { AmountControl, SidePicker } from './game-common';
import { useProduct } from './providers';
import { Icon } from './icons';
import { incentiveDeployment, tokenLabel, utcEpochLabel } from '@/lib/tokens';
import { assertWalletContext, type ConnectedWallet } from '@/lib/wallet';
const deployment = liveDeployment();
const rewards = incentiveDeployment('rewards');
type ErrorKey = MessageKey<'coinflip'> | `common:${MessageKey<'common'>}`;
/** A known wallet/chain error code maps to its translated message; anything else falls back to `fallback`. */
function errorOf(code: string, fallback: MessageKey<'coinflip'>): ErrorKey { return Object.prototype.hasOwnProperty.call(liveError, code) ? `common:liveError.${code}` as ErrorKey : fallback; }
export function LiveCoinflip({ onDemo }: { onDemo: () => void }) {
  const { wallet, setWalletOpen } = useProduct();
  const t = useT('coinflip');
  const tc = useT('common');
  const { locale } = useLocale();
  const sol = (lamports: bigint) => solLabelIn(lamports, locale);
  const [amount, setAmount] = useState('');
  const [side, setSide] = useState<Side>('heads');
  const [phase, setPhase] = useState<'idle' | 'reviewing' | 'review' | 'signing' | 'confirmed' | 'unknown' | 'settled'>('idle');
  const [quote, setQuote] = useState<bigint | null>(null);
  const [rewardOptIn, setRewardOptIn] = useState(false);
  const [rewardQuote, setRewardQuote] = useState<{ tokenUnits: bigint; epoch: bigint } | null>(null);
  const [error, setError] = useState<ErrorKey | ''>('');
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
      else if (raw) { setPhase('unknown'); setError('live.errors.trackingUnverified'); }
    } catch { setPhase('unknown'); setError('live.errors.storageRequired'); }
  }, [wallet, tracking]);
  function remember(next: LiveTracking, required = false) {
    if (!deployment) return;
    setTracking(next);
    try { sessionStorage.setItem(`sollish:devnet:${deployment.houseAuthority}:${deployment.shardId}:${next.player}`, encodeTracking(next)); }
    catch { if (required) throw new Error('TRACKING_STORAGE_FAILED'); else setError('live.errors.storageKeep'); }
  }
  const locked = ['reviewing', 'signing', 'confirmed', 'unknown'].includes(phase) || !!tracking;
  async function review() {
    if (!deployment || !wallet || busy.current || tracking || phase !== 'idle') return;
    const lamports = parseSol(amount);
    if (!lamports) { setError('live.errors.amountSol'); return; }
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
    } catch (cause) { if (mounted.current) { setError(errorOf(cause instanceof Error ? cause.message : '', 'live.errors.reviewFailed')); setPhase('idle'); } }
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
        setPhase('unknown'); setError('live.errors.unknownOutcome');
      } else {
        const code = cause instanceof Error ? cause.message : '';
        const storageFailedBeforeWallet = code === 'TRACKING_STORAGE_FAILED';
        if (storageFailedBeforeWallet) setTracking(null);
        setPhase(prepared && !storageFailedBeforeWallet ? 'unknown' : 'idle'); setQuote(null);
        setError(errorOf(code, prepared ? 'live.errors.sendUnverified' : 'live.errors.preflight'));
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
      if (mounted.current) { setResult(latest); if (latest?.status === 'settled') { setPhase('settled'); setError(''); } else if (!latest) setError('live.errors.notFound'); else setError(''); }
    } catch { if (mounted.current) setError('live.errors.readFailed'); }
    finally { if (mounted.current) setRefreshing(false); }
  }
  function nextBet() {
    if (!deployment || !tracking || phase !== 'settled' || result?.status !== 'settled') return;
    try { sessionStorage.removeItem(`sollish:devnet:${deployment.houseAuthority}:${deployment.shardId}:${tracking.player}`); }
    catch { setError('live.errors.clearFailed'); return; }
    setTracking(null); setResult(null); setQuote(null); setRewardQuote(null); setAmount(''); setPhase('idle'); setError('');
  }
  return <><section className="game-table live-coinflip"><div className="table-topline"><span className="table-status"><span className="status-dot"/>{t('live.network')}</span><span className="small muted">{t('live.testSol')}</span></div>{!deployment ? <div className="live-gate"><span className="stage-lock"><Icon name="lock" size={27}/></span><h2>{t('gate.title')}</h2><p>{t('gate.text')}</p><button className="text-button" onClick={onDemo}>{t('gate.tryDemo')}<Icon name="arrow" size={17}/></button><button className="button secondary" disabled>{t('action.liveClosed')}</button></div> : <div className="live-form"><div className="live-network-note"><Icon name="info" size={18}/><p>{t('live.note')}</p></div><SidePicker side={side} setSide={value => { setSide(value); setQuote(null); setPhase('idle'); }} disabled={locked}/><AmountControl amount={amount} setAmount={value => { setAmount(value); setQuote(null); setPhase('idle'); }} disabled={locked} unit="SOL"/>{rewards && <label className="reward-opt-in"><input type="checkbox" checked={rewardOptIn} disabled={locked} onChange={event => { setRewardOptIn(event.target.checked); setQuote(null); setRewardQuote(null); setPhase('idle'); }}/><span>{t('live.reward.label')}<small>{t('live.reward.hint')}</small></span></label>}{quote !== null && <dl className="detail-rows"><div><dt>{t('live.rows.stake')}</dt><dd>{t('live.sol', { amount: sol(parseSol(amount)!) })}</dd></div><div><dt>{t('live.rows.gross')}</dt><dd>{t('live.sol', { amount: sol(quote) })}</dd></div><div><dt>{t('live.rows.fees')}</dt><dd>{t('live.rows.feesValue')}</dd></div>{rewardQuote && <><div><dt>{t('live.rows.reward')}</dt><dd>{t('live.token', { amount: tokenLabel(rewardQuote.tokenUnits, 6, locale) })}</dd></div><div><dt>{t('live.rows.epoch')}</dt><dd>{utcEpochLabel(rewardQuote.epoch, locale, t('live.invalidEpoch'))}</dd></div></>}</dl>}{!tracking && <button className="button primary full-width" onClick={!wallet ? () => setWalletOpen(true) : phase === 'review' ? send : review} disabled={busy.current || phase === 'signing' || phase === 'reviewing' || phase === 'unknown'}>{!wallet ? t('live.button.connect') : phase === 'reviewing' ? t('live.button.reviewing') : phase === 'signing' ? t('live.button.signing') : phase === 'review' ? t('live.button.confirm') : t('live.button.review')}</button>}{tracking && <section className="live-tracking" aria-live="polite"><h3>{phase === 'settled' ? t('live.track.settled') : phase === 'confirmed' ? t('live.track.confirmed') : phase === 'signing' ? t('live.track.signing') : t('live.track.unknown')}</h3><p>{result?.status === 'awaiting-randomness' ? t('live.track.awaiting') : result?.status === 'ready-to-settle' ? t('live.track.ready') : result?.status === 'settled' ? t('live.track.paid', { amount: sol(result.payout) }) : t('live.track.default')}</p><a className="text-button" href={`https://explorer.solana.com/address/${tracking.betAddress}?cluster=devnet`} target="_blank" rel="noopener noreferrer">{t('live.account', { address: shortAddress(tracking.betAddress) })}<Icon name="link" size={16}/></a>{tracking.signature && <a className="text-button" href={`https://explorer.solana.com/tx/${tracking.signature}?cluster=devnet`} target="_blank" rel="noopener noreferrer">{t('live.tx')}<Icon name="link" size={16}/></a>}<button className="button secondary full-width" onClick={refresh} disabled={refreshing}>{refreshing ? t('live.refreshing') : t('live.refresh')}</button>{phase === 'settled' && <button className="button primary full-width" onClick={nextBet}>{t('live.next')}</button>}</section>}{error && <p className="form-error" role="alert">{error.startsWith('common:') ? tc(error.slice(7) as MessageKey<'common'>) : t(error as MessageKey<'coinflip'>)}</p>}</div>}</section><div className="demo-notice"><Icon name="shield" size={17}/><p>{t('live.notice')}</p></div></>;
}
