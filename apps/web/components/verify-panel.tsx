'use client';
import { useState } from 'react';
import { DAMLA_ENGINE_ID, GOREME_ENGINE_ID, SLOT_GAMES, type DamlaRound, type GoremeRound } from '@sollish/protocol';
import { DamlaPathFigure } from './damla/path-figure';
import { damlaMultiplierText, parseDamlaMode } from '@/lib/damla-controls';
import { configuredApi } from '@/lib/chat';
import { RgsClient, rgsErrorCode, safeSessionStorage, type RemoteHistoryRow } from '@/lib/rgs-client';
import { verifyForm, verifyHistoryRow, type RowStatus, type VerifyOutcome } from '@/lib/slot-verify';
import styles from './rgs-pages.module.css';
import { useFormat, useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/catalog';

const api = configuredApi(process.env.NEXT_PUBLIC_API_URL);
const GAME_KEYS = new Set(['cascade', 'tarhun', 'ebru', 'cezeri', 'asena', 'damla', 'goreme']);
const MODE_KEYS = new Set(['standard', 'ante', 'buy']);
const STATUS_KEY: Record<RowStatus | 'invalid', MessageKey<'verify'>> = { match: 'verify.statusMatch', mismatch: 'verify.statusMismatch', pending: 'verify.statusPending', invalid: 'verify.statusInvalid' };
type Form = { game: string; mode: string; betCents: string; serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: string; expectedSeedHex: string; expectedPayoutCents: string };
const EMPTY: Form = { game: 'cascade', mode: 'standard', betCents: '1000', serverSeed: '', serverSeedHash: '', clientSeed: '', nonce: '0', expectedSeedHex: '', expectedPayoutCents: '' };
type Row = RemoteHistoryRow & { status: RowStatus };

/** Paste a revealed server seed + client seed + nonce, or load this tab's server history; the browser recomputes the
 * seed, the whole engine round and the payout with the same protocol code the server ran. */
export function VerifyPanel() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  /** A message key: `verify.*` (this namespace) or `rgs.errors.*` (slotKit). */
  const [note, setNote] = useState('');
  const t = useT('verify');
  const common = useT('common');
  const kit = useT('slotKit');
  const format = useFormat();
  const gameName = (id: string) => (GAME_KEYS.has(id) ? common(`games.${id}` as MessageKey<'common'>) : id);
  const modeName = (id: string) => { const d = parseDamlaMode(id); return d ? t('damla.mode', d) : MODE_KEYS.has(id) ? common(`modes.${id}` as MessageKey<'common'>) : id; };
  const times = (hundredths: number) => format.amount(hundredths);
  const noteText = note.startsWith('verify.') ? t(note as MessageKey<'verify'>) : note.startsWith('rgs.errors.') ? kit(note as MessageKey<'slotKit'>) : note;
  const outcomeText = (o: VerifyOutcome) => (o.code === 'mismatch'
    ? t('outcome.mismatch', { failed: (o.failed ?? []).map(name => (t.has(`checks.${name}`) ? t(`checks.${name}` as MessageKey<'verify'>) : name)).join(', ') })
    : t(`outcome.${o.code}` as MessageKey<'verify'>));
  const game = SLOT_GAMES[form.game]!;
  const set = (key: keyof Form) => (event: { target: { value: string } }) => setForm(f => ({ ...f, [key]: event.target.value }));

  const run = async (input: Form) => {
    setBusy(true);
    try { setOutcome(await verifyForm(input)); } finally { setBusy(false); }
  };
  const client = () => (api ? new RgsClient({ baseUrl: api, storage: safeSessionStorage() }) : null);
  const load = async () => {
    const c = client();
    if (!c) { setNote('verify.noteNoServer'); return; }
    if (!c.hasSession) { setNote('verify.noteNoSession'); return; }
    setBusy(true); setNote('');
    try {
      const history = await c.history();
      setRows(await Promise.all(history.rounds.map(async row => ({ ...row, status: (await verifyHistoryRow(row)).status }))));
      if (!history.rounds.length) setNote('verify.noteEmpty');
    } catch (error) { setNote(`rgs.errors.${rgsErrorCode(error)}`); } finally { setBusy(false); }
  };
  const reveal = async () => {
    const c = client(); if (!c?.hasSession) return;
    setBusy(true);
    try { await c.rotate(); setNote('verify.noteRevealed'); } catch (error) { setNote(`rgs.errors.${rgsErrorCode(error)}`); setBusy(false); return; }
    setBusy(false);
    await load();
  };
  const fill = (row: Row) => {
    const next: Form = { game: row.game, mode: row.mode, betCents: String(row.betCents), serverSeed: row.fair.serverSeed ?? '', serverSeedHash: row.fair.serverSeedHash, clientSeed: row.fair.clientSeed, nonce: String(row.fair.nonce), expectedSeedHex: row.fair.seedHex, expectedPayoutCents: String(row.payoutCents) };
    setForm(next);
    if (row.fair.serverSeed) void run(next);
  };

  return (
    <div className={`game-page ${styles.page}`}>
      <div>
        <h1>{t('verify.title')}</h1>
        <p className={styles.lead}>{t('verify.lead')}</p>
      </div>

      <section className={styles.card} aria-labelledby="verify-form-title">
        <h2 id="verify-form-title">{t('verify.formTitle')}</h2>
        <form className={styles.form} onSubmit={event => { event.preventDefault(); void run(form); }}>
          <div className={styles.field}><label htmlFor="v-game">{t('verify.game')}</label>
            <select id="v-game" value={form.game} onChange={event => setForm(f => ({ ...f, game: event.target.value, betCents: String(SLOT_GAMES[event.target.value]!.betLevels.includes(Number(f.betCents)) ? f.betCents : SLOT_GAMES[event.target.value]!.betLevels[0]) }))}>
              {Object.values(SLOT_GAMES).map(g => <option key={g.id} value={g.id}>{gameName(g.id)} ({g.engineId})</option>)}
            </select></div>
          <div className={styles.field}><label htmlFor="v-mode">{t('verify.mode')}</label>
            <select id="v-mode" value={form.mode} onChange={set('mode')}>{game.modes.map(m => <option key={m} value={m}>{modeName(m)}</option>)}</select></div>
          <div className={styles.field}><label htmlFor="v-bet">{t('verify.bet')}</label>
            <select id="v-bet" value={form.betCents} onChange={set('betCents')}>{game.betLevels.map(b => <option key={b} value={b}>{format.number(b / 100)} DEMO</option>)}</select></div>
          <div className={styles.field}><label htmlFor="v-nonce">{t('verify.nonce')}</label><input id="v-nonce" inputMode="numeric" value={form.nonce} onChange={set('nonce')} autoComplete="off" /></div>
          <div className={`${styles.field} ${styles.wide}`}><label htmlFor="v-seed">{t('verify.serverSeed')}</label><input id="v-seed" className={styles.mono} value={form.serverSeed} onChange={set('serverSeed')} autoComplete="off" spellCheck={false} /></div>
          <div className={`${styles.field} ${styles.wide}`}><label htmlFor="v-hash">{t('verify.seedHash')}</label><input id="v-hash" className={styles.mono} value={form.serverSeedHash} onChange={set('serverSeedHash')} autoComplete="off" spellCheck={false} /></div>
          <div className={styles.field}><label htmlFor="v-client">{t('verify.clientSeed')}</label><input id="v-client" className={styles.mono} value={form.clientSeed} onChange={set('clientSeed')} autoComplete="off" spellCheck={false} /></div>
          <div className={styles.field}><label htmlFor="v-expected-seed">{t('verify.expectedSeed')}</label><input id="v-expected-seed" className={styles.mono} value={form.expectedSeedHex} onChange={set('expectedSeedHex')} autoComplete="off" spellCheck={false} /></div>
          <div className={styles.field}><label htmlFor="v-expected-pay">{t('verify.expectedPayout')}</label><input id="v-expected-pay" inputMode="numeric" value={form.expectedPayoutCents} onChange={set('expectedPayoutCents')} autoComplete="off" /></div>
          <div className={`${styles.actions} ${styles.wide}`}><button type="submit" className={styles.button} disabled={busy}>{t('verify.submit')}</button><button type="button" className={styles.ghost} onClick={() => { setForm(EMPTY); setOutcome(null); }}>{t('verify.clear')}</button></div>
        </form>
        {outcome && (
          <div role="status" aria-live="polite" data-testid="verify-result">
            <p><span className={`${styles.status} ${styles[outcome.status === 'invalid' ? 'pending' : outcome.status]}`}>{t(STATUS_KEY[outcome.status])}</span> {outcomeText(outcome)}</p>
            {outcome.result?.round && (
              <dl className={styles.facts}>
                <dt>{t('verify.factSeedHash')}</dt><dd className={styles.mono}>{outcome.result.serverSeedHash} {outcome.result.checks.hash === null ? '' : outcome.result.checks.hash ? '✓' : '✗'}</dd>
                <dt>{t('verify.factRoundSeed')}</dt><dd className={styles.mono}>{outcome.result.seedHex} {outcome.result.checks.seed === null ? '' : outcome.result.checks.seed ? '✓' : '✗'}</dd>
                <dt>{t('verify.factEngine')}</dt><dd>{outcome.result.round.engine}</dd>
                <dt>{t('verify.factCost')}</dt><dd>{format.number(outcome.result.round.costCents / 100)} DEMO</dd>
                <dt>{t('verify.factPayout')}</dt><dd>{format.number(outcome.result.round.payoutCents / 100)} DEMO · {times(outcome.result.round.totalHundredths)}× {outcome.result.checks.payout === null ? '' : outcome.result.checks.payout ? '✓' : '✗'}</dd>
                <dt>{t('verify.factFreeSpins')}</dt><dd>{outcome.result.round.freeSpinsTriggered ? t('verify.triggered') : t('verify.none')}{outcome.result.round.capped ? t('verify.maxWin') : ''}</dd>
              </dl>
            )}
            {outcome.result?.round && outcome.result.round.engine === GOREME_ENGINE_ID && (() => {
              const round = outcome.result.round as unknown as GoremeRound;
              const last = round.spins[round.spins.length - 1]!;
              return (
                <p className={styles.meta} data-testid="verify-goreme">{t('goreme.summary', { lifts: round.spins.reduce((n, sp) => n + sp.lifts, 0), free: round.spins.length - 1, sky: last.skyAfter })}</p>
              );
            })()}
            {outcome.result?.round && outcome.result.round.engine === DAMLA_ENGINE_ID && (() => {
              const round = outcome.result.round as unknown as DamlaRound;
              const vars = { path: round.path.join(''), pool: round.slot + 1, pools: round.rows + 1, rows: round.rows, multiplier: damlaMultiplierText(round.multiplierHundredths, format.locale) };
              return (
                <div className={styles.facts} data-testid="verify-damla">
                  <p><strong>{t('damla.path')}</strong>: <code className={styles.mono}>{t('damla.pathValue', vars)}</code></p>
                  <DamlaPathFigure round={round} locale={format.locale} label={t('damla.figure', vars)} />
                </div>
              );
            })()}
          </div>
        )}
      </section>

      <section className={styles.card} aria-labelledby="verify-history-title">
        <h2 id="verify-history-title">{t('verify.historyTitle')}</h2>
        <p className={styles.meta}>{t('verify.historyText')}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.ghost} onClick={() => void load()} disabled={busy || !api}>{t('verify.load')}</button>
          <button type="button" className={styles.ghost} onClick={() => void reveal()} disabled={busy || !rows}>{t('verify.reveal')}</button>
        </div>
        {note && <p role="status" className={styles.meta}>{noteText}</p>}
        {rows && rows.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th scope="col">{t('verify.colTime')}</th><th scope="col">{t('verify.colGame')}</th><th scope="col">{t('verify.colMode')}</th><th scope="col">{t('verify.colBet')}</th><th scope="col">{t('verify.colPayout')}</th><th scope="col">{t('verify.colNonce')}</th><th scope="col">{t('verify.colStatus')}</th><th scope="col"><span className="sr-only">{t('verify.fill')}</span></th></tr></thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.roundId} data-status={row.status}>
                    <td>{format.time(row.at)}</td><td>{gameName(row.game)}</td><td>{modeName(row.mode)}</td>
                    <td>{format.number(row.betCents / 100)}</td><td>{format.number(row.payoutCents / 100)}</td><td>{row.fair.nonce}</td>
                    <td><span className={`${styles.status} ${styles[row.status]}`}>{t(STATUS_KEY[row.status])}</span></td>
                    <td><button type="button" className={styles.ghost} onClick={() => fill(row)}>{t('verify.fill')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
