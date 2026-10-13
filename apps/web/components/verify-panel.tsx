'use client';
import { useState } from 'react';
import { SLOT_GAMES } from '@sollish/protocol';
import { demoNumber } from '@/lib/demo';
import { configuredApi } from '@/lib/chat';
import { RgsClient, rgsErrorMessage, safeSessionStorage, type RemoteHistoryRow } from '@/lib/rgs-client';
import { verifyForm, verifyHistoryRow, type RowStatus, type VerifyOutcome } from '@/lib/slot-verify';
import styles from './rgs-pages.module.css';

const api = configuredApi(process.env.NEXT_PUBLIC_API_URL);
const GAME_NAMES: Record<string, string> = { cascade: 'Candy Cascade', tarhun: 'Tarhun: Fırtına Tahtı' };
const MODE_NAMES: Record<string, string> = { standard: 'Standart', ante: 'Şans ×2', buy: 'Bonus satın alma' };
const STATUS_TEXT: Record<RowStatus | 'invalid', string> = { match: 'Eşleşti', mismatch: 'Uyuşmuyor', pending: 'Tohum açıklanmadı', invalid: 'Geçersiz giriş' };
const times = (hundredths: number) => (hundredths / 100).toFixed(2).replace('.', ',');
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
  const [note, setNote] = useState('');
  const game = SLOT_GAMES[form.game]!;
  const set = (key: keyof Form) => (event: { target: { value: string } }) => setForm(f => ({ ...f, [key]: event.target.value }));

  const run = async (input: Form) => {
    setBusy(true);
    try { setOutcome(await verifyForm(input)); } finally { setBusy(false); }
  };
  const client = () => (api ? new RgsClient({ baseUrl: api, storage: safeSessionStorage() }) : null);
  const load = async () => {
    const c = client();
    if (!c) { setNote('Sunucu bu yapıda tanımlı değil (NEXT_PUBLIC_API_URL).'); return; }
    if (!c.hasSession) { setNote('Bu sekmede sunucu doğrulamalı oturum yok. Önce bir oyunu sunucu modunda oyna.'); return; }
    setBusy(true); setNote('');
    try {
      const history = await c.history();
      setRows(await Promise.all(history.rounds.map(async row => ({ ...row, status: (await verifyHistoryRow(row)).status }))));
      if (!history.rounds.length) setNote('Bu oturumda henüz sunucu turu yok.');
    } catch (error) { setNote(rgsErrorMessage(error)); } finally { setBusy(false); }
  };
  const reveal = async () => {
    const c = client(); if (!c?.hasSession) return;
    setBusy(true);
    try { await c.rotate(); setNote('Sunucu tohumu açıklandı ve yenisine geçildi. Önceki turlar artık doğrulanabilir.'); } catch (error) { setNote(rgsErrorMessage(error)); setBusy(false); return; }
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
        <h1>Tur doğrulama</h1>
        <p className={styles.lead}>Sunucu doğrulamalı DEMO turlarında sunucu tohumunun özeti tur oynanmadan önce gösterilir. Tohum açıklanınca bu sayfa tur tohumunu (HMAC-SHA256), motorun bütün turunu ve kazancı tarayıcında yeniden hesaplar. Sertifikalı RNG değildir; DEMO kredisi değersizdir.</p>
      </div>

      <section className={styles.card} aria-labelledby="verify-form-title">
        <h2 id="verify-form-title">Tohumla hesapla</h2>
        <form className={styles.form} onSubmit={event => { event.preventDefault(); void run(form); }}>
          <div className={styles.field}><label htmlFor="v-game">Oyun</label>
            <select id="v-game" value={form.game} onChange={event => setForm(f => ({ ...f, game: event.target.value, betCents: String(SLOT_GAMES[event.target.value]!.betLevels.includes(Number(f.betCents)) ? f.betCents : SLOT_GAMES[event.target.value]!.betLevels[0]) }))}>
              {Object.values(SLOT_GAMES).map(g => <option key={g.id} value={g.id}>{GAME_NAMES[g.id] ?? g.id} ({g.engineId})</option>)}
            </select></div>
          <div className={styles.field}><label htmlFor="v-mode">Mod</label>
            <select id="v-mode" value={form.mode} onChange={set('mode')}>{game.modes.map(m => <option key={m} value={m}>{MODE_NAMES[m] ?? m}</option>)}</select></div>
          <div className={styles.field}><label htmlFor="v-bet">Bahis</label>
            <select id="v-bet" value={form.betCents} onChange={set('betCents')}>{game.betLevels.map(b => <option key={b} value={b}>{demoNumber(b)} DEMO</option>)}</select></div>
          <div className={styles.field}><label htmlFor="v-nonce">Nonce</label><input id="v-nonce" inputMode="numeric" value={form.nonce} onChange={set('nonce')} autoComplete="off" /></div>
          <div className={`${styles.field} ${styles.wide}`}><label htmlFor="v-seed">Açıklanan sunucu tohumu (64 karakter)</label><input id="v-seed" className={styles.mono} value={form.serverSeed} onChange={set('serverSeed')} autoComplete="off" spellCheck={false} /></div>
          <div className={`${styles.field} ${styles.wide}`}><label htmlFor="v-hash">Önceden gösterilen tohum özeti (isteğe bağlı)</label><input id="v-hash" className={styles.mono} value={form.serverSeedHash} onChange={set('serverSeedHash')} autoComplete="off" spellCheck={false} /></div>
          <div className={styles.field}><label htmlFor="v-client">Oyuncu tohumu</label><input id="v-client" className={styles.mono} value={form.clientSeed} onChange={set('clientSeed')} autoComplete="off" spellCheck={false} /></div>
          <div className={styles.field}><label htmlFor="v-expected-seed">Beklenen tur tohumu (isteğe bağlı)</label><input id="v-expected-seed" className={styles.mono} value={form.expectedSeedHex} onChange={set('expectedSeedHex')} autoComplete="off" spellCheck={false} /></div>
          <div className={styles.field}><label htmlFor="v-expected-pay">Beklenen kazanç, DEMO kuruş (isteğe bağlı)</label><input id="v-expected-pay" inputMode="numeric" value={form.expectedPayoutCents} onChange={set('expectedPayoutCents')} autoComplete="off" /></div>
          <div className={`${styles.actions} ${styles.wide}`}><button type="submit" className={styles.button} disabled={busy}>Doğrula</button><button type="button" className={styles.ghost} onClick={() => { setForm(EMPTY); setOutcome(null); }}>Temizle</button></div>
        </form>
        {outcome && (
          <div role="status" aria-live="polite" data-testid="verify-result">
            <p><span className={`${styles.status} ${styles[outcome.status === 'invalid' ? 'pending' : outcome.status]}`}>{STATUS_TEXT[outcome.status]}</span> {outcome.message}</p>
            {outcome.result?.round && (
              <dl className={styles.facts}>
                <dt>Tohum özeti</dt><dd className={styles.mono}>{outcome.result.serverSeedHash} {outcome.result.checks.hash === null ? '' : outcome.result.checks.hash ? '✓' : '✗'}</dd>
                <dt>Tur tohumu</dt><dd className={styles.mono}>{outcome.result.seedHex} {outcome.result.checks.seed === null ? '' : outcome.result.checks.seed ? '✓' : '✗'}</dd>
                <dt>Motor</dt><dd>{outcome.result.round.engine}</dd>
                <dt>Maliyet</dt><dd>{demoNumber(outcome.result.round.costCents)} DEMO</dd>
                <dt>Kazanç</dt><dd>{demoNumber(outcome.result.round.payoutCents)} DEMO · {times(outcome.result.round.totalHundredths)}× {outcome.result.checks.payout === null ? '' : outcome.result.checks.payout ? '✓' : '✗'}</dd>
                <dt>Bedava dönüş</dt><dd>{outcome.result.round.freeSpinsTriggered ? 'Tetiklendi' : 'Yok'}{outcome.result.round.capped ? ' · azami kazanç' : ''}</dd>
              </dl>
            )}
          </div>
        )}
      </section>

      <section className={styles.card} aria-labelledby="verify-history-title">
        <h2 id="verify-history-title">Oturum geçmişim</h2>
        <p className={styles.meta}>Bu sekmedeki sunucu oturumunun son 50 turu. Açıklanmamış tohumun turları “Tohum açıklanmadı” görünür; “Tohumu açıkla” mevcut tohumu açıklar ve yeni bir tohuma geçer.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.ghost} onClick={() => void load()} disabled={busy || !api}>Oturum geçmişini yükle</button>
          <button type="button" className={styles.ghost} onClick={() => void reveal()} disabled={busy || !rows}>Tohumu açıkla</button>
        </div>
        {note && <p role="status" className={styles.meta}>{note}</p>}
        {rows && rows.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Zaman</th><th scope="col">Oyun</th><th scope="col">Mod</th><th scope="col">Bahis</th><th scope="col">Kazanç</th><th scope="col">Nonce</th><th scope="col">Durum</th><th scope="col"><span className="sr-only">Forma aktar</span></th></tr></thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.roundId} data-status={row.status}>
                    <td>{new Date(row.at).toLocaleTimeString('tr-TR')}</td><td>{GAME_NAMES[row.game] ?? row.game}</td><td>{MODE_NAMES[row.mode] ?? row.mode}</td>
                    <td>{demoNumber(row.betCents)}</td><td>{demoNumber(row.payoutCents)}</td><td>{row.fair.nonce}</td>
                    <td><span className={`${styles.status} ${styles[row.status]}`}>{STATUS_TEXT[row.status]}</span></td>
                    <td><button type="button" className={styles.ghost} onClick={() => fill(row)}>Forma aktar</button></td>
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
