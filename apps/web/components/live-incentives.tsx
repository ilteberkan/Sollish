'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { IncentivesDeployment, IncentiveAction, IncentiveTicket } from '@sollish/onchain';
import { decodeIncentiveTracking, storageKey, type IncentiveTracking as Tracking } from '@/lib/incentive-tracking';
import { useProduct } from './providers';
import { Icon } from './icons';
import { shortAddress } from '@/lib/demo';
import { liveError, transactionWallet } from '@/lib/live';
import { solLabelIn } from '@/lib/sol-label';
import { useLocale, useT } from '@/lib/i18n/client';
import { INTL_LOCALE } from '@/lib/i18n/config';
import type { MessageKey } from '@/lib/i18n/catalog';
import type { Translator } from '@/lib/i18n/translator';
import { parseTokens, tokenLabel, utcEpochLabel } from '@/lib/tokens';
import { assertWalletContext, type ConnectedWallet } from '@/lib/wallet';

type StakingState = Awaited<ReturnType<typeof import('@sollish/onchain')['readStakingState']>>;
type RewardState = Awaited<ReturnType<typeof import('@sollish/onchain')['readRewardState']>>;
type Request = { action: IncentiveAction; amount?: bigint; epoch?: bigint };
type Operation = 'idle' | 'checking' | 'review' | 'signing' | 'unknown' | 'pending' | 'failed' | 'finalized';
const LOCAL_ERRORS = ['NOTHING_TO_CLAIM', 'HOURLY_NOT_CLAIMABLE', 'POOL_ENDED', 'INSUFFICIENT_TOKEN_BALANCE', 'INSUFFICIENT_STAKE', 'INSUFFICIENT_TOKEN_RESERVE', 'POSITION_MISSING', 'SNAPSHOT_EPOCH_CHANGED'] as const;
/** An error is stored as a message key (so it follows the language): a wallet/chain code from `common`, or one of this namespace. */
type ErrorKey = MessageKey<'incentives'> | `common:${MessageKey<'common'>}`;
const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
function errorOf(code: string, fallback: MessageKey<'incentives'>): ErrorKey {
  if (has(liveError, code)) return `common:liveError.${code}` as ErrorKey;
  return (LOCAL_ERRORS as readonly string[]).includes(code) ? `errors.${code}` as ErrorKey : fallback;
}
function errorText(key: ErrorKey, t: Translator<'incentives'>, tc: Translator<'common'>): string {
  return key.startsWith('common:') ? tc(key.slice(7) as MessageKey<'common'>) : t(key as MessageKey<'incentives'>);
}
function useTokenOperation(deployment: IncentivesDeployment, kind: 'stake' | 'rewards', refresh: () => Promise<void>) {
  const { wallet } = useProduct();
  const [operation, setOperation] = useState<Operation>('idle');
  const [error, setError] = useState<ErrorKey | ''>('');
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
    } catch { setOperation('unknown'); setError('op.trackingUnreadable'); }
  }, [deployment, kind, wallet, tracking]);
  const save = (value: Tracking, required = false) => {
    if (alive.current) setTracking(value);
    try { sessionStorage.setItem(storageKey(deployment, value.ticket.player, kind), JSON.stringify(value)); }
    catch { if (required) throw new Error('TRACKING_STORAGE_FAILED'); else if (alive.current) setError('op.storageKeep'); }
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
    } catch (cause) { if (alive.current) { setOperation('idle'); setError(errorOf(cause instanceof Error ? cause.message : '', 'op.prepareFailed')); } }
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
        setError('op.unknownResult');
      } else {
        const code = cause instanceof Error ? cause.message : '';
        const beforeWallet = code === 'TRACKING_STORAGE_FAILED';
        if (beforeWallet) setTracking(null);
        setOperation(prepared && !beforeWallet ? 'unknown' : 'idle');
        setError(errorOf(code, prepared ? 'op.sendUnverified' : 'op.preflight'));
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
    } catch { if (alive.current) { setOperation('unknown'); setError('op.finalityUnreadable'); } }
    finally { busy.current = false; }
  };
  const reset = () => {
    if (busy.current || !tracking || !['finalized', 'failed'].includes(operation)) return;
    try { sessionStorage.removeItem(storageKey(deployment, tracking.ticket.player, kind)); }
    catch { setError('op.clearFailed'); return; }
    setTracking(null); setQuote(null); setRequest(null); setOperation('idle'); setError('');
  };
  return { operation, error, quote, tracking, prepare, send, track, reset,
    cancel: () => { if (!busy.current && !tracking) { setOperation('idle'); setQuote(null); setRequest(null); } },
    blocked: operation !== 'idle' || tracking !== null,
  };
}
type TokenOperation = ReturnType<typeof useTokenOperation>;
function OperationPanel({ flow }: { flow: TokenOperation }) {
  const t = useT('incentives');
  const tc = useT('common');
  const { locale } = useLocale();
  return <>{flow.operation === 'checking' && <p className="operation-status" role="status">{t('panel.checking')}</p>}{flow.operation === 'review' && flow.quote && <section className="token-review" aria-label={t('panel.reviewLabel')}><h3>{t(`action.${flow.quote.action}`)}</h3><dl className="detail-rows"><div><dt>{flow.quote.action.startsWith('claim') ? t('panel.claimAmount') : t('panel.amount')}</dt><dd>{t('tokenAmount', { amount: tokenLabel(flow.quote.amount, 6, locale) })}</dd></div><div><dt>{t('panel.mint')}</dt><dd title={flow.quote.tokenMint}>{shortAddress(flow.quote.tokenMint)}</dd></div><div><dt>{t('panel.network')}</dt><dd>{t('panel.networkValue')}</dd></div><div><dt>{t('panel.fees')}</dt><dd>{t('panel.feesValue')}</dd></div>{flow.quote.epoch !== null && <div><dt>{t('panel.epoch')}</dt><dd>{utcEpochLabel(flow.quote.epoch, locale, t('rewards.invalidEpoch'))}</dd></div>}</dl><p>{t('panel.reviewNote')}</p><div className="token-review-actions"><button className="button secondary" onClick={flow.cancel}>{t('panel.cancel')}</button><button className="button primary" onClick={flow.send}>{t('panel.confirm')}</button></div></section>}{flow.operation === 'signing' && <p className="operation-status" role="status">{t('panel.signing')}</p>}{flow.tracking && <section className="token-tracking" aria-live="polite"><h3>{flow.operation === 'finalized' ? t('track.finalized') : flow.operation === 'failed' ? t('track.failed') : flow.operation === 'signing' ? t('track.signing') : t('track.pending')}</h3><p>{flow.operation === 'finalized' ? t('track.textFinalized') : flow.operation === 'failed' ? t('track.textFailed') : t('track.textPending')}</p>{flow.tracking.signature && <a className="text-button" href={`https://explorer.solana.com/tx/${flow.tracking.signature}?cluster=devnet`} target="_blank" rel="noopener noreferrer">{t('track.viewTx')}<Icon name="link" size={16}/></a>}<button className="button secondary" disabled={flow.operation === 'signing'} onClick={flow.track}>{t('track.check')}</button>{['finalized', 'failed'].includes(flow.operation) && <button className="text-button" onClick={flow.reset}>{t('track.back')}<Icon name="arrow" size={16}/></button>}</section>}{flow.error && <p className="form-error" role="alert">{errorText(flow.error, t, tc)}</p>}</>;
}

export function LiveStake({ deployment }: { deployment: IncentivesDeployment }) {
  const { wallet, setWalletOpen } = useProduct();
  const t = useT('incentives');
  const { locale } = useLocale();
  const token = (units: bigint) => tokenLabel(units, 6, locale);
  const [state, setState] = useState<StakingState | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState(false);
  const [amount, setAmount] = useState('');
  const [action, setAction] = useState<'stake' | 'unstake'>('stake');
  const address = useRef(wallet?.address); address.current = wallet?.address;
  const load = useCallback(async () => {
    if (!wallet) return;
    const player = wallet.address; setLoading(true); setReadError(false);
    try { const sdk = await import('@sollish/onchain'); const next = await sdk.readStakingState(deployment, player); if (address.current === player) setState(next); }
    catch { if (address.current === player) { setState(null); setReadError(true); } }
    finally { if (address.current === player) setLoading(false); }
  }, [deployment, wallet]);
  useEffect(() => { setState(null); if (wallet) void load(); }, [wallet, load]);
  const flow = useTokenOperation(deployment, 'stake', load);
  const units = parseTokens(amount);
  const maximum = action === 'stake' ? state?.walletBalance : state?.staked;
  const ended = !!state && state.chainTimestamp >= state.endTs;
  return <div className="live-token-page"><div className="live-token-banner"><Icon name="shield" size={20}/><div><strong>{t('stake.bannerTitle')}</strong><p>{t('stake.bannerText')}</p></div><span className="mode-badge neutral-badge">{t('badge.testnet')}</span></div>{!wallet ? <div className="token-wallet-gate"><Icon name="wallet" size={30}/><h2>{t('stake.gateTitle')}</h2><p>{t('stake.gateText')}</p><button className="button primary" onClick={() => setWalletOpen(true)}>{t('connect')}</button></div> : <><div className="section-heading token-section-heading"><h2>{t('stake.position')}</h2><button className="text-button" onClick={() => void load()} disabled={loading || flow.blocked}>{loading ? t('reading') : t('refresh')}<Icon name="history" size={16}/></button></div>{readError && <p className="form-error" role="alert">{t('stake.readError')}</p>}<div className="live-stake-grid"><section className="live-stake-position"><span>{t('stake.staked')}</span><strong className="token-large">{state ? token(state.staked) : '—'}<small> {t('unit.token')}</small></strong><dl className="detail-rows"><div><dt>{t('stake.walletBalance')}</dt><dd>{state ? t('tokenAmount', { amount: token(state.walletBalance) }) : `— ${t('unit.token')}`}</dd></div><div><dt>{t('stake.pending')}</dt><dd>{state ? t('tokenAmount', { amount: token(state.pendingRewards) }) : `— ${t('unit.token')}`}</dd></div><div><dt>{t('stake.total')}</dt><dd>{state ? t('tokenAmount', { amount: token(state.totalStaked) }) : `— ${t('unit.token')}`}</dd></div><div><dt>{t('stake.budget')}</dt><dd>{state ? t('tokenAmount', { amount: token(state.budget) }) : `— ${t('unit.token')}`}</dd></div><div><dt>{t('stake.ends')}</dt><dd>{state ? new Date(Number(state.endTs) * 1000).toLocaleString(INTL_LOCALE[locale], { timeZone: 'UTC' }) + ' UTC' : '—'}</dd></div></dl><button className="button secondary full-width" disabled={!state || state.pendingRewards === 0n || flow.blocked || loading} onClick={() => void flow.prepare({ action: 'claim-staking' })}>{t('stake.claimReview')}</button></section><section className="live-stake-controls"><div className="mode-switch" aria-label={t('stake.actionLabel')}><button aria-pressed={action === 'stake'} disabled={flow.blocked} onClick={() => setAction('stake')}>{t('stake.tabStake')}</button><button aria-pressed={action === 'unstake'} disabled={flow.blocked} onClick={() => setAction('unstake')}>{t('stake.tabUnstake')}</button></div><label htmlFor="stake-amount">{t('stake.amountLabel')}</label><div className="amount-input-wrap"><input id="stake-amount" inputMode="decimal" value={amount} placeholder={t('stake.placeholder')} disabled={flow.blocked || !state} onChange={event => setAmount(event.target.value)}/><span>{t('unit.tokenCap')}</span></div><p className="small muted">{t('stake.available', { amount: maximum !== undefined ? token(maximum) : '—' })}</p><button className="button primary full-width" disabled={!state || !units || maximum === undefined || units > maximum || flow.blocked || loading || (action === 'stake' && ended)} onClick={() => { if (units) void flow.prepare({ action, amount: units }); }}>{action === 'stake' && ended ? t('stake.btnEnded') : action === 'stake' ? t('stake.btnStake') : t('stake.btnUnstake')}</button><p className="small muted">{t('stake.note')}</p></section></div><OperationPanel flow={flow}/>{state && <a className="text-button" target="_blank" rel="noopener noreferrer" href={`https://explorer.solana.com/address/${state.poolAddress}?cluster=devnet`}>{t('stake.pool')}<Icon name="link" size={16}/></a>}</>}<div className="demo-notice"><Icon name="info" size={16}/><p>{t('stake.notice')}</p></div></div>;
}

export function LiveRewards({ deployment }: { deployment: IncentivesDeployment }) {
  const { wallet, setWalletOpen } = useProduct();
  const t = useT('incentives');
  const { locale } = useLocale();
  const token = (units: bigint) => tokenLabel(units, 6, locale);
  const sol = (lamports: bigint) => t('testSol', { amount: solLabelIn(lamports, locale) });
  const [state, setState] = useState<RewardState | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState(false);
  const [epoch, setEpoch] = useState<bigint | undefined>();
  const address = useRef(wallet?.address); address.current = wallet?.address;
  const load = useCallback(async () => {
    if (!wallet) return;
    const player = wallet.address; setLoading(true); setReadError(false);
    try { const sdk = await import('@sollish/onchain'); let next = await sdk.readRewardState(deployment, player, epoch); if (epoch === undefined && next.epoch >= next.endEpoch) next = await sdk.readRewardState(deployment, player, next.endEpoch - 1n); if (address.current === player) setState(next); }
    catch { if (address.current === player) { setState(null); setReadError(true); } }
    finally { if (address.current === player) setLoading(false); }
  }, [deployment, epoch, wallet]);
  useEffect(() => { setState(null); if (wallet) void load(); }, [wallet, load]);
  const flow = useTokenOperation(deployment, 'rewards', load);
  return <div className="live-token-page"><div className="live-token-banner"><Icon name="gift" size={22}/><div><strong>{t('rewards.bannerTitle')}</strong><p>{t('rewards.bannerText')}</p></div><span className="mode-badge neutral-badge">{t('badge.testnet')}</span></div>{!wallet ? <div className="token-wallet-gate"><Icon name="wallet" size={30}/><h2>{t('rewards.gateTitle')}</h2><p>{t('rewards.gateText')}</p><button className="button primary" onClick={() => setWalletOpen(true)}>{t('connect')}</button></div> : <><div className="section-heading token-section-heading"><h2>{t('rewards.heading')}</h2><button className="text-button" disabled={loading || flow.blocked} onClick={() => void load()}>{loading ? t('reading') : t('refresh')}<Icon name="history" size={16}/></button></div>{readError && <p className="form-error" role="alert">{t('rewards.readError')}</p>}<section className="live-wager-rewards"><div><span>{t('rewards.wagerClaimable')}</span><strong className="token-large">{state ? token(state.wagerPending) : '—'}<small> {t('unit.token')}</small></strong><p>{t('rewards.wagerNote')}</p></div><button className="button primary" disabled={!state || state.wagerPending === 0n || flow.blocked || loading} onClick={() => void flow.prepare({ action: 'claim-wager' })}>{t('rewards.wagerReview')}</button></section><section className="live-hourly"><div className="section-heading"><h2>{t('rewards.hourly')}</h2><Icon name="clock" size={20}/></div><div className="epoch-picker"><button className="icon-button" aria-label={t('rewards.prevHour')} disabled={!state || state.epoch <= state.startEpoch || flow.blocked || loading} onClick={() => { if (state) setEpoch(state.epoch - 1n); }}><Icon name="chevron" style={{ transform: 'rotate(180deg)' }}/></button><strong>{state ? utcEpochLabel(state.epoch, locale, t('rewards.invalidEpoch')) : t('rewards.epochUnread')}</strong><button className="icon-button" aria-label={t('rewards.nextHour')} disabled={!state || state.epoch + 1n >= state.currentEpoch || state.epoch + 1n >= state.endEpoch || flow.blocked || loading} onClick={() => { if (state) setEpoch(state.epoch + 1n); }}><Icon name="chevron"/></button></div><dl className="detail-rows"><div><dt>{t('rewards.hourlyShare')}</dt><dd>{state ? t('tokenAmount', { amount: token(state.hourlyClaimable) }) : `— ${t('unit.token')}`}</dd></div><div><dt>{t('rewards.eligibility')}</dt><dd>{state ? state.recordExists ? state.qualified ? t('rewards.qualified') : t('rewards.notQualified') : t('rewards.noRecord') : t('rewards.unverified')}</dd></div><div><dt>{t('rewards.playerWager')}</dt><dd>{state ? sol(state.playerWager) : t('testSol', { amount: '—' })}</dd></div><div><dt>{t('rewards.qualifiedTotal')}</dt><dd>{state ? sol(state.qualifiedWagerTotal) : t('testSol', { amount: '—' })}</dd></div><div><dt>{t('rewards.minWager')}</dt><dd>{state ? sol(state.minimumWager) : t('testSol', { amount: '—' })}</dd></div><div><dt>{t('rewards.hourlyBudget')}</dt><dd>{state ? t('tokenAmount', { amount: token(state.hourlyBudget) }) : `— ${t('unit.token')}`}</dd></div></dl><p>{t('rewards.hourlyNote')}</p><button className="button secondary full-width" disabled={!state || !state.qualified || !state.recordExists || !state.epochFinished || flow.blocked || loading} onClick={() => { if (state) void flow.prepare({ action: 'claim-hourly', epoch: state.epoch }); }}>{state?.recordExists && state.qualified && state.hourlyClaimable === 0n ? t('rewards.btnCloseZero') : t('rewards.btnHourly')}</button></section><OperationPanel flow={flow}/>{state && <a className="text-button" target="_blank" rel="noopener noreferrer" href={`https://explorer.solana.com/address/${state.phaseAddress}?cluster=devnet`}>{t('rewards.phase')}<Icon name="link" size={16}/></a>}</>}<div className="demo-notice"><Icon name="info" size={16}/><p>{t('rewards.notice')}</p></div></div>;
}
