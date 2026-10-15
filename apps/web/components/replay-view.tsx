'use client';
import { useEffect, useMemo, useState } from 'react';
import { demoNumber } from '@/lib/demo';
import { configuredApi } from '@/lib/chat';
import { fetchReplay, rgsErrorMessage, RgsError, type RemoteReplay } from '@/lib/rgs-client';
import { replayFrames, verifyReplay, type ReplayCell, type RowStatus } from '@/lib/slot-verify';
import { SymbolArt, type CascadeArtSymbol } from './cascade/symbols';
import { StormSymbolArt, type StormSymbol } from './storm/symbols';
import { EbruStainArt, EbruSymbolArt, type EbruSymbol } from './ebru/symbols';
import { CezeriSymbolArt, type CezeriSymbol } from './cezeri/symbols';
import styles from './rgs-pages.module.css';

const api = configuredApi(process.env.NEXT_PUBLIC_API_URL);
const GAME_NAMES: Record<string, string> = { cascade: 'Candy Cascade', tarhun: 'Tarhun: Fırtına Tahtı', ebru: 'Ebru: Mürekkep Bahçesi', cezeri: 'Cezeri: Zamanın Çarkları' };
const MODE_NAMES: Record<string, string> = { standard: 'Standart', ante: 'Şans ×2', buy: 'Bonus satın alma' };
const times = (hundredths: number) => (hundredths / 100).toFixed(2).replace('.', ',');
type State = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; replay: RemoteReplay; frames: ReturnType<typeof replayFrames>; verified: RowStatus };

function Cell({ game, cell, win }: { game: string; cell: ReplayCell; win: boolean }) {
  return (
    <div className={`${styles.cell} ${win ? styles.win : ''}`}>
      {game === 'cascade' ? <SymbolArt symbol={cell.symbol as CascadeArtSymbol} multiplier={cell.multiplier} size="100%" />
        : game === 'ebru' ? <EbruSymbolArt symbol={cell.symbol as EbruSymbol} size="100%" />
        : game === 'cezeri' ? <CezeriSymbolArt symbol={cell.symbol as CezeriSymbol} size="100%" />
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
  useEffect(() => {
    let cancelled = false;
    if (!api) { setState({ phase: 'error', message: 'Paylaşım sunucusu bu yapıda tanımlı değil.' }); return; }
    fetchReplay(api, id).then(async ({ replay, round }) => {
      const verified = (await verifyReplay(replay)).status;
      if (!cancelled) setState({ phase: 'ready', replay, frames: replayFrames(round), verified });
    }, (error: unknown) => {
      if (!cancelled) setState({ phase: 'error', message: error instanceof RgsError && error.code === 'NOT_FOUND' ? 'Bu paylaşım bulunamadı veya süresi doldu.' : rgsErrorMessage(error) });
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

  if (state.phase === 'loading') return <div className={`game-page ${styles.page}`}><h1>Paylaşılan tur</h1><p role="status" className={styles.meta}>Tur yükleniyor…</p></div>;
  if (state.phase === 'error') return <div className={`game-page ${styles.page}`}><h1>Paylaşılan tur</h1><p role="alert">{state.message}</p></div>;
  const { replay } = state;
  return (
    <div className={`game-page ${styles.page}`}>
      <div>
        <h1>{GAME_NAMES[replay.game] ?? replay.game} · paylaşılan tur</h1>
        <p className={styles.lead}>Sunucunun imzaladığı tur kaydı; bakiye, zaman veya oturum bilgisi içermez. Tur, kayıttaki tohumla tarayıcında aynı motorla yeniden oluşturuldu. DEMO kredisi değersizdir.</p>
      </div>
      <section className={styles.card} aria-labelledby="replay-summary">
        <h2 id="replay-summary">Sonuç</h2>
        <dl className={styles.facts}>
          <dt>Mod</dt><dd>{MODE_NAMES[replay.mode] ?? replay.mode}</dd>
          <dt>Bahis</dt><dd>{demoNumber(replay.betCents)} DEMO (maliyet {demoNumber(replay.costCents)} DEMO)</dd>
          <dt>Kazanç</dt><dd><strong>{demoNumber(replay.payoutCents)} DEMO</strong> · {times(replay.totalHundredths)}×</dd>
          <dt>Motor</dt><dd>{replay.engineId}</dd>
          <dt>Doğrulama</dt><dd data-testid="replay-verified"><span className={`${styles.status} ${styles[state.verified]}`}>{state.verified === 'match' ? 'Tohumla doğrulandı' : state.verified === 'mismatch' ? 'Uyuşmuyor' : 'Sunucu tohumu henüz açıklanmadı'}</span></dd>
          <dt>Tohum özeti</dt><dd className={styles.mono}>{replay.fair.serverSeedHash}</dd>
          <dt>Tur tohumu</dt><dd className={styles.mono}>{replay.fair.seedHex} · nonce {replay.fair.nonce}</dd>
        </dl>
      </section>
      <section className={`${styles.card} ${styles.player}`} aria-labelledby="replay-player">
        <h2 id="replay-player">Tekrar</h2>
        {frame ? (
          <>
            <p className={styles.meta} aria-live="polite">{frame.kind === 'base' ? 'Temel dönüş' : `Bedava dönüş ${frame.spin}`} · adım {frame.step + 1}/{frame.steps}{frame.stepHundredths > 0 ? ` · +${times(frame.stepHundredths)}×` : ''}{frame.step === frame.steps - 1 ? ` · toplam ${times(frame.totalAfterHundredths)}×` : ''}</p>
            <div className={styles.board} role="img" aria-label={`Izgara, ${frame.winIds.length} kazanan ${replay.game === 'ebru' ? 'damla' : replay.game === 'cezeri' ? 'dilim' : 'taş'}`}
              style={{ gridTemplateColumns: `repeat(${frame.grid.length}, minmax(0, 1fr))`, aspectRatio: `${frame.grid.length} / ${frame.grid[0]?.length ?? 5}` }}>
              {Array.from({ length: frame.grid[0]?.length ?? 0 }, (_, row) => row).flatMap(row => frame.grid.map((column, col) => { const cell = column[row]!; return <Cell key={`${col}-${row}-${cell.id}`} game={replay.game} cell={cell} win={winSet.has(cell.id)} />; }))}
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.ghost} onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0}>Geri</button>
              <button type="button" className={styles.button} onClick={() => { if (index >= frames.length - 1) setIndex(0); setPlaying(p => index >= frames.length - 1 ? true : !p); }}>{playing && index < frames.length - 1 ? 'Duraklat' : index >= frames.length - 1 ? 'Baştan oynat' : 'Oynat'}</button>
              <button type="button" className={styles.ghost} onClick={() => setIndex(i => Math.min(frames.length - 1, i + 1))} disabled={index >= frames.length - 1}>İleri</button>
              <span className={styles.meta}>{index + 1}/{frames.length}</span>
            </div>
          </>
        ) : <p>Bu turun adımları gösterilemedi.</p>}
      </section>
    </div>
  );
}
