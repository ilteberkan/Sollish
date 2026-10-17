'use client';
import { useEffect, useMemo, useState } from 'react';
import { configuredApi } from '@/lib/chat';
import { fetchReplay, rgsErrorMessage, RgsError, type RemoteReplay } from '@/lib/rgs-client';
import { ALL_SLOT_ENGINES } from '@/lib/slot-engines/all';
import { replayFrames, verifyReplay, type ReplayCell, type RowStatus } from '@/lib/slot-verify';
import { SymbolArt, type CascadeArtSymbol } from './cascade/symbols';
import { StormSymbolArt, type StormSymbol } from './storm/symbols';
import { EbruStainArt, EbruSymbolArt, type EbruSymbol } from './ebru/symbols';
import { CezeriSymbolArt, type CezeriSymbol } from './cezeri/symbols';
import { AsenaSymbolArt, type AsenaSymbol } from './asena/symbols';
import styles from './rgs-pages.module.css';
import { useFormat, useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/catalog';

const api = configuredApi(process.env.NEXT_PUBLIC_API_URL);
const GAME_KEYS = new Set(['cascade', 'tarhun', 'ebru', 'cezeri', 'asena']);
const MODE_KEYS = new Set(['standard', 'ante', 'buy']);
/** `message` is a verify-namespace key, or (from lib/rgs-client) an already formatted text. */
type State = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; replay: RemoteReplay; frames: ReturnType<typeof replayFrames>; verified: RowStatus };

function Cell({ game, cell, win }: { game: string; cell: ReplayCell; win: boolean }) {
  return (
    <div className={`${styles.cell} ${win ? styles.win : ''}`}>
      {game === 'cascade' ? <SymbolArt symbol={cell.symbol as CascadeArtSymbol} multiplier={cell.multiplier} size="100%" />
        : game === 'ebru' ? <EbruSymbolArt symbol={cell.symbol as EbruSymbol} size="100%" />
        : game === 'cezeri' ? <CezeriSymbolArt symbol={cell.symbol as CezeriSymbol} size="100%" />
        : game === 'asena' ? <AsenaSymbolArt symbol={cell.symbol as AsenaSymbol} size="100%" />
        : <StormSymbolArt symbol={cell.symbol as StormSymbol} multiplier={cell.multiplier} size="100%" />}
      {cell.stain ? <span className={styles.stain}><EbruStainArt value={cell.stain} size="100%" /></span> : null}
      {cell.multiplier ? <span className={styles.mult}>×{cell.multiplier}</span> : null}
    </div>
  );
}

/** A shared server round, replayed step by step from the signed record. No balance, no ledger, no session. */
export function ReplayView({ id }: { id: string }) {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const t = useT('verify');
  const common = useT('common');
  const format = useFormat();
  const times = (hundredths: number) => format.amount(hundredths);
  const gameName = (id: string) => (GAME_KEYS.has(id) ? common(`games.${id}` as MessageKey<'common'>) : id);
  const modeName = (id: string) => (MODE_KEYS.has(id) ? common(`modes.${id}` as MessageKey<'common'>) : id);
  useEffect(() => {
    let cancelled = false;
    if (!api) { setState({ phase: 'error', message: 'replay.noServer' }); return; }
    fetchReplay(api, id, ALL_SLOT_ENGINES).then(async ({ replay, round }) => {
      const verified = (await verifyReplay(replay)).status;
      if (!cancelled) setState({ phase: 'ready', replay, frames: replayFrames(round), verified });
    }, (error: unknown) => {
      if (!cancelled) setState({ phase: 'error', message: error instanceof RgsError && error.code === 'NOT_FOUND' ? 'replay.notFound' : rgsErrorMessage(error) });
    });
    return () => { cancelled = true; };
  }, [id]);
  useEffect(() => { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(false); }, []);
  const frames = state.phase === 'ready' ? state.frames : [];
  useEffect(() => {
    if (!playing || index >= frames.length - 1) return;
    const timer = window.setTimeout(() => setIndex(i => Math.min(frames.length - 1, i + 1)), frames[index]?.winIds.length ? 1300 : 800);
    return () => window.clearTimeout(timer);
  }, [playing, index, frames]);
  const frame = frames[index];
  const winSet = useMemo(() => new Set(frame?.winIds ?? []), [frame]);

  if (state.phase === 'loading') return <div className={`game-page ${styles.page}`}><h1>{t('replay.title')}</h1><p role="status" className={styles.meta}>{t('replay.loading')}</p></div>;
  if (state.phase === 'error') return <div className={`game-page ${styles.page}`}><h1>{t('replay.title')}</h1><p role="alert">{state.message.startsWith('replay.') ? t(state.message as MessageKey<'verify'>) : state.message}</p></div>;
  const { replay } = state;
  return (
    <div className={`game-page ${styles.page}`}>
      <div>
        <h1>{t('replay.heading', { game: gameName(replay.game) })}</h1>
        <p className={styles.lead}>{t('replay.lead')}</p>
      </div>
      <section className={styles.card} aria-labelledby="replay-summary">
        <h2 id="replay-summary">{t('replay.summary')}</h2>
        <dl className={styles.facts}>
          <dt>{t('replay.mode')}</dt><dd>{modeName(replay.mode)}</dd>
          <dt>{t('replay.bet')}</dt><dd>{t('replay.betValue', { bet: format.number(replay.betCents / 100), cost: format.number(replay.costCents / 100) })}</dd>
          <dt>{t('replay.payout')}</dt><dd><strong>{format.number(replay.payoutCents / 100)} DEMO</strong> · {times(replay.totalHundredths)}×</dd>
          <dt>{t('replay.engine')}</dt><dd>{replay.engineId}</dd>
          <dt>{t('replay.verification')}</dt><dd data-testid="replay-verified"><span className={`${styles.status} ${styles[state.verified]}`}>{state.verified === 'match' ? t('replay.verified') : state.verified === 'mismatch' ? t('replay.mismatch') : t('replay.pending')}</span></dd>
          <dt>{t('replay.seedHash')}</dt><dd className={styles.mono}>{replay.fair.serverSeedHash}</dd>
          <dt>{t('replay.roundSeed')}</dt><dd className={styles.mono}>{replay.fair.seedHex} · nonce {replay.fair.nonce}</dd>
        </dl>
      </section>
      <section className={`${styles.card} ${styles.player}`} aria-labelledby="replay-player">
        <h2 id="replay-player">{t('replay.player')}</h2>
        {frame ? (
          <>
            <p className={styles.meta} aria-live="polite">{frame.kind === 'base' ? t('replay.base') : t('replay.free', { n: frame.spin })} · {t('replay.step', { n: frame.step + 1, total: frame.steps })}{frame.stepHundredths > 0 ? ` · +${times(frame.stepHundredths)}×` : ''}{frame.step === frame.steps - 1 ? ` · ${t('replay.total', { times: times(frame.totalAfterHundredths) })}` : ''}</p>
            <div className={styles.board} role="img" aria-label={t('replay.board', { count: frame.winIds.length, unit: replay.game })}
              style={{ gridTemplateColumns: `repeat(${frame.grid.length}, minmax(0, 1fr))`, aspectRatio: `${frame.grid.length} / ${frame.grid[0]?.length ?? 5}` }}>
              {Array.from({ length: frame.grid[0]?.length ?? 0 }, (_, row) => row).flatMap(row => frame.grid.map((column, col) => { const cell = column[row]!; return <Cell key={`${col}-${row}-${cell.id}`} game={replay.game} cell={cell} win={winSet.has(cell.id)} />; }))}
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.ghost} onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0}>{t('replay.back')}</button>
              <button type="button" className={styles.button} onClick={() => { if (index >= frames.length - 1) setIndex(0); setPlaying(p => index >= frames.length - 1 ? true : !p); }}>{playing && index < frames.length - 1 ? t('replay.pause') : index >= frames.length - 1 ? t('replay.restart') : t('replay.play')}</button>
              <button type="button" className={styles.ghost} onClick={() => setIndex(i => Math.min(frames.length - 1, i + 1))} disabled={index >= frames.length - 1}>{t('replay.forward')}</button>
              <span className={styles.meta}>{index + 1}/{frames.length}</span>
            </div>
          </>
        ) : <p>{t('replay.noSteps')}</p>}
      </section>
    </div>
  );
}
