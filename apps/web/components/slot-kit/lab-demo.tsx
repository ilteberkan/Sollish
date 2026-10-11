'use client';
import { useEffect, useRef, useState } from 'react';
import { createAutoplay, cancelAutoplay, nextDecision, recordRound, type AutoplayConfig, type AutoplayState } from '@/lib/slot-kit/autoplay';
import { clampBetToLimits, createBetLadder, formatDemo, type CostMode } from '@/lib/slot-kit/bet';
import {
  AutoplayPanel, AutoplayStopButton, BetSelector, BuyFeatureDialog, GameInfo, Modal, RealityCheckDialog, SessionBar, SettingsPanel, Toggle, useSession, useSlotSettings,
  type GameInfoPage,
} from '.';
import { cx } from './cx';
import kit from './kit.module.css';
import styles from './lab.module.css';

const LADDER = createBetLadder([10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000]);
const ANTE: CostMode = { num: 5, den: 4 };
const START_BALANCE = 100_000;

const PAGES: GameInfoPage[] = [
  { id: 'how', title: 'Nasıl oynanır', content: (<><h3>Nasıl oynanır</h3><p>Bahsinizi seçin ve dönüşü başlatın. 8 veya daha fazla aynı sembol ızgaranın herhangi bir yerinde kazandırır.</p><ul><li>Kazanan semboller patlar, yenileri düşer.</li><li>Yeni kazanç kalmayana kadar zincir sürer.</li></ul></>) },
  { id: 'pay', title: 'Ödeme tablosu', content: (<><h3>Ödeme tablosu</h3><table><thead><tr><th>Sembol</th><th>8–9</th><th>10–11</th><th>12+</th></tr></thead><tbody><tr><td>Taç</td><td>10,00</td><td>25,00</td><td>50,00</td></tr><tr><td>Kek</td><td>2,50</td><td>10,00</td><td>25,00</td></tr><tr><td>Kiraz</td><td>0,40</td><td>0,90</td><td>4,00</td></tr></tbody></table><p>Tutarlar DEMO ve bahse göre hesaplanır.</p></>) },
  { id: 'features', title: 'Özellikler', content: (<><h3>Bedava dönüş</h3><p>4 yıldız 10 bedava dönüş açar. Bedava dönüşte çarpan kristalleri düşer.</p><h3>Şans ×2</h3><p>Bahsin 1,25 katına mal olur; bedava dönüş şansı artar.</p></>) },
  { id: 'rtp', title: 'RTP', content: (<><h3>Teorik dönüş</h3><table><thead><tr><th>Mod</th><th>RTP</th></tr></thead><tbody><tr><td>Standart</td><td>%95,80</td></tr><tr><td>Şans ×2</td><td>%95,80</td></tr><tr><td>Bonus satın alma</td><td>%96,10</td></tr></tbody></table><p>Azami kazanç bahsin 5.000 katıdır.</p></>) },
  { id: 'keys', title: 'Tuşlar', content: (<><h3>Klavye</h3><p><kbd>Boşluk</kbd> dönüş başlatır ve kazanç sayacını atlar.</p><p><kbd>←</kbd> <kbd>→</kbd> bilgi sayfalarında gezinir, <kbd>Esc</kbd> pencereyi kapatır.</p></>) },
  { id: 'rules', title: 'Arıza hükmü', content: (<><h3>Arıza hükmü</h3><p>Arıza tüm ödemeleri ve turları geçersiz kılar.</p></>) },
];

/** Deterministic outcomes so the demo autoplay is repeatable. */
function outcome(index: number, bet: number): { payout: number; feature: boolean } {
  const n = (index * 2654435761) % 1000;
  if (n < 30) return { payout: bet * 12, feature: true };
  if (n < 140) return { payout: bet * 3, feature: false };
  if (n < 340) return { payout: Math.round(bet * 0.4), feature: false };
  return { payout: 0, feature: false };
}

export function SlotKitLab() {
  const { settings, update, reset, ready } = useSlotSettings('lab-demo');
  const session = useSession();
  const recordSession = session.recordRound;
  const [balance, setBalance] = useState(START_BALANCE);
  const [bet, setBet] = useState(100);
  const [ante, setAnte] = useState(false);
  const [autoplayLog, setAutoplayLog] = useState('Henüz başlatılmadı.');
  const [auto, setAuto] = useState<AutoplayState | null>(null);
  const [startedWith, setStartedWith] = useState<AutoplayConfig | null>(null);
  const [modal, setModal] = useState<'info' | 'buy' | 'buyBlocked' | 'settings' | 'plain' | null>(null);
  const [reality, setReality] = useState(false);
  const spinIndex = useRef(1);
  const costMode = ante ? ANTE : undefined;
  const cost = ante ? Math.ceil((bet * 5) / 4) : bet;

  useEffect(() => { setBet(prev => clampBetToLimits(LADDER, prev, { balanceCents: balance, cost: costMode })); }, [balance, costMode]);

  // Demo autoplay loop: one round every 450 ms, driven entirely by the pure controller.
  useEffect(() => {
    if (!auto) return;
    const timer = window.setTimeout(() => {
      const decision = nextDecision(auto, { balanceCents: balance, nextCostCents: cost, tabHidden: document.hidden });
      if (!decision.continue) {
        setAutoplayLog(`Durdu: ${decision.reason} · ${auto.spinsDone} tur, net ${formatDemo(auto.wonCents - auto.spentCents)}`);
        setAuto(null);
        return;
      }
      const result = outcome(spinIndex.current++, bet);
      const after = balance - cost + result.payout;
      setBalance(after);
      recordSession({ costCents: cost, payoutCents: result.payout });
      setAuto(recordRound(auto, { costCents: cost, payoutCents: result.payout, featureTriggered: result.feature, balanceAfterCents: after }));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [auto, balance, bet, cost, recordSession]);

  useEffect(() => { if (session.realityDue) setReality(true); }, [session.realityDue]);

  const start = (config: AutoplayConfig) => {
    setStartedWith(config);
    setAutoplayLog('Çalışıyor…');
    setAuto(createAutoplay(config, balance));
  };

  return (
    <div className={cx(kit.kit, styles.lab)}>
      <p className={styles.lead}>Bütün Sollish oyunlarının ortak slot kiti. Her bileşen bu sayfada örnek verilerle görünür; renkler --sk-* özel özellikleriyle değiştirilir.</p>
      <SessionBar nowMs={session.nowMs} elapsedMs={session.elapsedMs} netCents={session.netCents} />
      <div className={styles.grid}>
        <section className={styles.card} aria-label="Ayarlar">
          <h2>SettingsPanel</h2>
          <SettingsPanel settings={settings} onChange={update} onReset={reset} />
          <p className={styles.out}>Kayıtlı: <strong>{ready ? 'tarayıcıdan okundu' : 'yükleniyor'}</strong> · hız {settings.spinSpeed} · {settings.muted ? 'sessiz' : 'ses açık'}</p>
        </section>

        <section className={styles.card} aria-label="Otomatik oyun">
          <h2>AutoplayPanel · AutoplayStopButton</h2>
          {auto ? (
            <div className={styles.stage}>
              <AutoplayStopButton remaining={auto.spinsRemaining} onStop={() => setAuto(cancelAutoplay(auto))} />
              <p className={styles.out}>Net kayıp limiti <strong>{startedWith ? formatDemo(startedWith.lossLimitCents) : ''}</strong><br />{auto.spinsDone} tur oynandı</p>
            </div>
          ) : (
            <AutoplayPanel onStart={start} spinCostCents={cost} balanceCents={balance} />
          )}
          <p className={styles.out} role="status">{autoplayLog}</p>
        </section>

        <section className={styles.card} aria-label="Bahis">
          <h2>BetSelector</h2>
          <p className={styles.balance}>Bakiye <strong>{formatDemo(balance)}</strong> <button type="button" className={kit.chip} onClick={() => setBalance(START_BALANCE)}>Bakiyeyi yenile</button></p>
          <BetSelector
            ladder={LADDER}
            valueCents={bet}
            onChange={setBet}
            balanceCents={balance}
            maxBetCents={5000}
            costMode={costMode}
            modeLabel={ante ? 'Şans ×2' : undefined}
            disabled={auto !== null}
          />
          <Toggle label="Şans ×2" description="Bahsin 1,25 katına mal olur." checked={ante} onChange={setAnte} disabled={auto !== null} />
          <div className={styles.row}>
            <button type="button" className={cx(kit.btn, kit.btnPrimary)} disabled={auto !== null || balance < cost} onClick={() => {
              const result = outcome(spinIndex.current++, bet);
              setBalance(b => b - cost + result.payout);
              session.recordRound({ costCents: cost, payoutCents: result.payout });
            }}>Tek dönüş · {formatDemo(cost)}</button>
          </div>
        </section>

        <section className={styles.card} aria-label="Pencereler">
          <h2>GameInfo · BuyFeatureDialog · RealityCheckDialog · Modal</h2>
          <div className={styles.row}>
            <button type="button" className={cx(kit.btn, kit.btnGhost)} onClick={() => setModal('info')}>Oyun bilgisi</button>
            <button type="button" className={cx(kit.btn, kit.btnGhost)} onClick={() => setModal('buy')}>Bonus satın al</button>
            <button type="button" className={cx(kit.btn, kit.btnGhost)} onClick={() => setModal('buyBlocked')}>Satın al (engelli)</button>
            <button type="button" className={cx(kit.btn, kit.btnGhost)} onClick={() => setReality(true)}>Hatırlatma</button>
            <button type="button" className={cx(kit.btn, kit.btnGhost)} onClick={() => setModal('settings')}>Ayarlar penceresi</button>
            <button type="button" className={cx(kit.btn, kit.btnGhost)} onClick={() => setModal('plain')}>Boş pencere</button>
          </div>
          <p className={styles.out}>Pencereler Esc ile kapanır, odağı içeride tutar, 600 pikselin altında alttan açılır. Hatırlatma Esc ile kapanmaz.</p>
        </section>
      </div>

      <GameInfo open={modal === 'info'} onClose={() => setModal(null)} pages={PAGES} />
      <BuyFeatureDialog
        open={modal === 'buy'}
        onClose={() => setModal(null)}
        onConfirm={() => { setBalance(b => b - bet * 100); setModal(null); }}
        featureName="10 bedava dönüş"
        priceCents={bet * 100}
        balanceCents={balance}
        rtpText="Satın alma modu RTP: %96,10 (standart mod %95,80)"
        description="Bahsin 100 katı. Bedava dönüşler hemen başlar."
      />
      <BuyFeatureDialog
        open={modal === 'buyBlocked'}
        onClose={() => setModal(null)}
        onConfirm={() => setModal(null)}
        featureName="10 bedava dönüş"
        priceCents={bet * 100}
        rtpText="Satın alma modu RTP: %96,10"
        disabledReason="Şans ×2 açıkken satın alınamaz"
      />
      <RealityCheckDialog open={reality} elapsedMs={session.elapsedMs + 31 * 60_000} netCents={session.netCents} onContinue={() => { setReality(false); session.acknowledge(); }} onQuit={() => { setReality(false); session.acknowledge(); }} />
      <Modal open={modal === 'settings'} onClose={() => setModal(null)} title="Ayarlar" size="md"><SettingsPanel settings={settings} onChange={update} onReset={reset} /></Modal>
      <Modal open={modal === 'plain'} onClose={() => setModal(null)} title="Boş pencere" size="sm" footer={<button type="button" className={cx(kit.btn, kit.btnPrimary)} onClick={() => setModal(null)}>Tamam</button>}>
        <p className={kit.copy}>Odak tuzağı, Esc, kaydırma kilidi ve alttan açılma davranışını denemek için.</p>
      </Modal>
    </div>
  );
}
