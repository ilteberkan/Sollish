'use client';
import type { ReactNode } from 'react';
import {
  CEZERI_BET_LEVELS_CENTS, CEZERI_FREE_SPINS_RETRIGGER, CEZERI_FREE_SPINS_TRIGGER, CEZERI_GEAR_PAY, CEZERI_MAX_FREE_SPINS, CEZERI_MAX_RESPINS,
  CEZERI_MAX_WIN_MULTIPLIER, CEZERI_MODE_TABLES, CEZERI_PAYTABLE, CEZERI_RESERVOIR_LEVELS, CEZERI_RETRIGGER_VESSELS, CEZERI_RTP, CEZERI_SCATTER_PAY,
  CEZERI_TRIGGER_VESSELS, CEZERI_FALCON_COUNT, type CezeriMode, type CezeriPaySymbol,
} from '@sollish/protocol';
import type { GameInfoPage } from '../slot-kit';
import { formatAmount, formatDemo } from '@/lib/slot-kit/bet';
import { CEZERI_MODE_LABELS, cezeriCost, cezeriRtp, cezeriRtpRange } from '@/lib/cezeri-controls';
import { cezeriCents, cezeriMoney, cezeriTimes } from '@/lib/cezeri-timeline';
import { CEZERI_SYMBOL_LABELS, CezeriSymbolArt } from './symbols';
import styles from './cezeri-info.module.css';

const MODES: CezeriMode[] = ['standard', 'ante', 'buy'];
const ORDER: CezeriPaySymbol[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4'];
const HIGH = new Set<CezeriPaySymbol>(['h1', 'h2', 'h3', 'h4']);
const pct = (ratio: number, digits = 1) => `%${(ratio * 100).toFixed(digits).replace('.', ',')}`;
const int = (n: number) => new Intl.NumberFormat('tr-TR').format(n);
const HUB_BASE = CEZERI_MODE_TABLES.standard.hubBase;
const HUB_TOTAL = HUB_BASE.reduce((sum, [, w]) => sum + w, 0);
const FALCON_TOTAL = CEZERI_FALCON_COUNT.reduce((sum, [, w]) => sum + w, 0);

function Feature({ art, title, children }: { art?: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className={styles.feature}>
      {art && <span className={styles.featureArt} aria-hidden="true">{art}</span>}
      <div><h4>{title}</h4>{children}</div>
    </section>
  );
}

/** A tiny spoke diagram: hub on the left, rings 1..4 to the right, the paying run lit. */
function SpokeDiagram({ start, length }: { start: 0 | 1; length: 3 | 4 }) {
  return (
    <span className={styles.spoke} aria-hidden="true">
      <i className={styles.spokeHub}>×</i>
      {[0, 1, 2, 3].map(r => <i key={r} data-on={r >= start && r < start + length || undefined} />)}
    </span>
  );
}

function Paytable({ betCents }: { betCents: number }) {
  const amount = (h: number) => cezeriMoney(cezeriCents(betCents, h));
  return (
    <div className={styles.page}>
      <h3>Ödeme tablosu</h3>
      <p className={styles.lead}>Bir <strong>ışın</strong> boyunca içten dışa aynı sembolden <strong>3 veya 4 ardışık dilim</strong> öder. Büyük rakam <strong>{formatDemo(betCents)}</strong> bahiste ışın başına brüt DEMO tutarıdır (göbek ×1); altındaki çarpan bahsin katıdır. Göbek çarpanı bu tutarı çarpar.</p>
      <div className={styles.runs} aria-label="Geçerli seriler">
        <span><SpokeDiagram start={0} length={4} /> Halka 1–4 · 4 dilim</span>
        <span><SpokeDiagram start={0} length={3} /> Halka 1–3 · 3 dilim</span>
        <span><SpokeDiagram start={1} length={3} /> Halka 2–4 · 3 dilim</span>
      </div>
      <ul className={styles.payGrid} aria-label="Sembol ödemeleri">
        {ORDER.map(symbol => {
          const [t3, t4] = CEZERI_PAYTABLE[symbol];
          return (
            <li key={symbol} className={`${styles.payCard} ${HIGH.has(symbol) ? styles.payHigh : ''}`}>
              <span className={styles.payArt} aria-hidden="true"><CezeriSymbolArt symbol={symbol} size="100%" /></span>
              <div className={styles.payBody}>
                <h4 className={styles.payName}>{CEZERI_SYMBOL_LABELS[symbol]}</h4>
                <dl className={styles.payRows}>
                  <div><dt>4 dilim</dt><dd><strong>{amount(t4)}</strong><small>{cezeriTimes(t4)}×</small></dd></div>
                  <div><dt>3 dilim</dt><dd><strong>{amount(t3)}</strong><small>{cezeriTimes(t3)}×</small></dd></div>
                </dl>
              </div>
            </li>
          );
        })}
      </ul>
      <div className={styles.specials}>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><CezeriSymbolArt symbol="gear" size="100%" /></span>
          <div>
            <h4>{CEZERI_SYMBOL_LABELS.gear}</h4>
            <dl className={styles.scatterRows}>
              <div><dt>4 dişli</dt><dd><strong>{amount(CEZERI_GEAR_PAY[1])}</strong> <small>{cezeriTimes(CEZERI_GEAR_PAY[1])}×</small></dd></div>
              <div><dt>3 dişli</dt><dd><strong>{amount(CEZERI_GEAR_PAY[0])}</strong> <small>{cezeriTimes(CEZERI_GEAR_PAY[0])}×</small></dd></div>
            </dl>
            <p>Su Kabı dışındaki her sembolün yerine geçer. Yalnız dişlilerden oluşan seri kendi tablosuyla öder; serinin daha çok ödeyen okunuşu sayılır.</p>
          </div>
        </section>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><CezeriSymbolArt symbol="vessel" size="100%" /></span>
          <div>
            <h4>{CEZERI_SYMBOL_LABELS.vessel} · dağınık ödeme</h4>
            <dl className={styles.scatterRows}>
              <div><dt>5+ kap</dt><dd><strong>{amount(CEZERI_SCATTER_PAY[5])}</strong> <small>{cezeriTimes(CEZERI_SCATTER_PAY[5])}×</small></dd></div>
              <div><dt>4 kap</dt><dd><strong>{amount(CEZERI_SCATTER_PAY[4])}</strong> <small>{cezeriTimes(CEZERI_SCATTER_PAY[4])}×</small></dd></div>
              <div><dt>3 kap</dt><dd><strong>{amount(CEZERI_SCATTER_PAY[3])}</strong> <small>{cezeriTimes(CEZERI_SCATTER_PAY[3])}×</small></dd></div>
            </dl>
            <p>Dönüşün son tahtasında, halkaların herhangi bir yerinde sayılır; göbekle çarpılmaz. Temel oyunda {CEZERI_TRIGGER_VESSELS}+ kap <strong>{CEZERI_FREE_SPINS_TRIGGER} bedava dönüş</strong> açar.</p>
          </div>
        </section>
        <section className={`${styles.special} ${styles.specialMax}`}>
          <div>
            <h4>Azami kazanç {int(CEZERI_MAX_WIN_MULTIPLIER)}×</h4>
            <p>Bu bahiste <strong>{formatDemo(betCents * CEZERI_MAX_WIN_MULTIPLIER)}</strong>. Tur toplamı bu tavana ulaşırsa tur hemen biter; kalan bedava dönüşler oynanmaz.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Multi-page game information (game-standards §3 "Bilgi"). Amounts follow the current bet. */
export function cezeriInfoPages(betCents: number): GameInfoPage[] {
  const minBet = CEZERI_BET_LEVELS_CENTS[0]!, maxBet = CEZERI_BET_LEVELS_CENTS[CEZERI_BET_LEVELS_CENTS.length - 1]!;
  return [
    {
      id: 'how', title: 'Nasıl oynanır',
      content: (
        <div className={styles.page}>
          <h3>Nasıl oynanır</h3>
          <ol className={styles.steps}>
            <li><strong>Bahsini seç.</strong> − ve + düğmeleri bahsi bir basamak değiştirir; bahis tutarına dokununca bütün basamaklar açılır. "Azami bahis" bakiyenin yettiği en yüksek basamağı seçer.</li>
            <li><strong>Çevir.</strong> Kurma kolu düğmesine bas veya Boşluk tuşunu kullan. Tur maliyeti (Şans ×2 açıksa bahsin 1,25 katı) bakiyeden bir kez düşer.</li>
            <li><strong>Çarklar.</strong> Tahta bir göbek ve çevresinde 4 eşmerkezli halkadır; her halka 12 dilimlidir ve kendi şeridinde döner. Göbekten dışa 12 ışın uzanır.</li>
            <li><strong>Işın kazancı.</strong> Bir ışın üzerinde aynı sembolden ardışık 3 veya 4 dilim halka 1’den ya da halka 2’den başlarsa öder. 12 ışın ayrı ayrı öder. Kazanç o dönüşün göbek çarpanıyla çarpılır.</li>
            <li><strong>Dişli Kilidi.</strong> Yeni kazanç varsa kazanan dilimler kenetlenir, dört halka altlarında yeniden döner ve göbek <strong>+1</strong> artar. Yeni ödeme gelmeyene kadar sürer (en çok {CEZERI_MAX_RESPINS} yeniden dönüş).</li>
            <li><strong>Sonuç.</strong> Turun tamamı dönüş başlamadan önce motorla belirlenir; animasyon yalnızca bu sonucu oynatır. Çevir düğmesi tur (bütün yeniden dönüşler ve bedava dönüşler) bitene kadar kilitlidir; hızlandırmak için Hızlı/Turbo ayarını kullan. Hız ayarı, kutlama sayacına dokunmak, gizli sekme veya sayfadan ayrılmak ödemeyi değiştirmez; tur her durumda bir kez, motorun ödemesiyle kapanır.</li>
          </ol>
          <p className={styles.note}>DEMO kredisi değersizdir; SOL, token veya ödül kazandırmaz. Oyun tarayıcıda yerel rastgelelikle çalışır, VRF kanıtı yoktur.</p>
        </div>
      ),
    },
    { id: 'pay', title: 'Ödeme tablosu', content: <Paytable betCents={betCents} /> },
    {
      id: 'features', title: 'Özellikler',
      content: (
        <div className={styles.page}>
          <h3>Özellikler</h3>
          <Feature title="Göbek çarpanı" art={<span className={styles.hubBadge}>×5</span>}>
            <p>Her dönüş göbeğin çekilmesiyle başlar; göbek o dönüşün bütün ışın kazançlarını çarpar. Temel oyunda çekiliş olasılıkları:</p>
            <ul className={styles.hubRow} aria-label="Göbek çekilişi">
              {HUB_BASE.map(([value, weight]) => <li key={value}><strong>×{value}</strong><small>{pct(weight / HUB_TOTAL)}</small></li>)}
            </ul>
          </Feature>
          <Feature title="Dişli Kilidi (yeniden dönüş zinciri)" art={<CezeriSymbolArt symbol="h1" size="100%" />}>
            <p>Bir dönüşte <strong>yeni</strong> ödeme varsa kazanan serilerin dilimleri kilitlenir; simgelerini korur, kıpırdamaz. Sonra <strong>dört halkanın hepsi</strong> kilitli dilimlerin altında yeniden döner ve göbek her yeniden dönüşte <strong>+1</strong> artar. Kilitli bir seri uzarsa (3 → 4 dilim) yalnız aradaki fark ödenir. Zincir yeni ödemesiz ilk dönüşte, 48 dilimin hepsi kilitlenince ya da {CEZERI_MAX_RESPINS} yeniden dönüşte biter (son dönüş yine ödenir). Taban oyunda yeniden dönüşler halka başına bir Altın Dişli içeren şeritlerde döner.</p>
          </Feature>
          <Feature title={`Fil Saati (${CEZERI_FREE_SPINS_TRIGGER} bedava dönüş)`} art={<CezeriSymbolArt symbol="vessel" size="100%" />}>
            <p>Temel oyunda {CEZERI_TRIGGER_VESSELS} veya daha fazla Su Kabı {CEZERI_FREE_SPINS_TRIGGER} bedava dönüş açar. Göbek çarpanı bedava dönüşler arasında <strong>sıfırlanmaz</strong>: her dönüş, önceki dönüşün bittiği göbekle kendi çekilişinin büyüğünden başlar ve yeniden dönüşler +1 ekler; göbek yalnız artar. Bedava dönüşte {CEZERI_RETRIGGER_VESSELS}+ kap {CEZERI_FREE_SPINS_RETRIGGER} dönüş daha ekler (ödemesiz). Bir turda en çok {CEZERI_MAX_FREE_SPINS} bedava dönüş verilir.</p>
          </Feature>
          <Feature title="Su haznesi ve otomat şahin" art={<CezeriSymbolArt symbol="gear" size="100%" />}>
            <p>Her bedava dönüşten sonra hazne bir kademe dolar. {CEZERI_RESERVOIR_LEVELS}. kademede boşalır ve dönüş kaldıysa otomat şahin bir halkaya {CEZERI_FALCON_COUNT.map(([n, w]) => `${n} (${pct(w / FALCON_TOTAL, 0)})`).join(', ')} Altın Dişli joker dilimi bırakır. Bu jokerler özellik bitene kadar yerinde kalır ve sonraki her dönüşte kazanç tamamlayabilir.</p>
          </Feature>
          <Feature title="Kazanç kademeleri ve çarpan anonsu">
            <p>Tur toplamı taban bahsin <strong>10 katı</strong> veya üstüyse kutlama ekranı açılır ve sayaç kademeler arasında tırmanır: Büyük Kazanç ≥10×, Mega Kazanç ≥25×, Süper Kazanç ≥50×, Efsane Kazanç ≥100×; tavana ulaşan tur Azami Kazanç ile biter. Göbek ×10, ×25, ×50 ve ×100 eşiklerini geçtiğinde büyük yazıyla ve kendi sesiyle duyurulur. Bedava dönüş turu her zaman "Fil Saati — Toplam" ekranıyla biter. Ekrana dokunmak sayacı hemen sonuca getirir; ödemeyi değiştirmez.</p>
          </Feature>
          <Feature title={`Şans ×2 · maliyet ${formatDemo(cezeriCost(betCents, 'ante'))}`}>
            <p>Açıkken her dönüş bahsin <strong>1,25 katına</strong> mal olur ve temel oyunda Su Kabı daha sık gelir: bedava dönüş şansı yaklaşık 2 katıdır ({pct(CEZERI_RTP.ante.featureRate, 2)} / {pct(CEZERI_RTP.standard.featureRate, 2)}). Kazançlar yine taban bahse göre ödenir. Açıkken bonus satın alınamaz.</p>
          </Feature>
          <Feature title={`Bonus satın al · fiyat ${formatDemo(cezeriCost(betCents, 'buy'))}`}>
            <p>Bahsin <strong>100 katı</strong> karşılığında temel dönüş bitince tahtada en az {CEZERI_TRIGGER_VESSELS} Su Kabı olur (eksikse kazanç dışındaki dilimler kaba dönüşür); {CEZERI_FREE_SPINS_TRIGGER} bedava dönüş garantilidir. Onay penceresiyle yapılır, ayrı bir RTP ile çalışır ({cezeriRtp(CEZERI_RTP.buy.rtp)}) ve otomatik oyunla kullanılamaz.</p>
          </Feature>
        </div>
      ),
    },
    {
      id: 'rtp', title: 'RTP',
      content: (
        <div className={styles.page}>
          <h3>Teorik dönüş (RTP)</h3>
          <div className={styles.tableWrap}>
            <table>
              <caption className="sr-only">Mod başına teorik dönüş</caption>
              <thead><tr><th scope="col">Mod</th><th scope="col">Maliyet</th><th scope="col">RTP</th><th scope="col">%95 GA</th><th scope="col">Özellik</th></tr></thead>
              <tbody>
                {MODES.map(mode => {
                  const r = CEZERI_RTP[mode];
                  return (
                    <tr key={mode}>
                      <th scope="row">{CEZERI_MODE_LABELS[mode]}</th>
                      <td>{mode === 'standard' ? '×1' : mode === 'ante' ? '×1,25' : '×100'}</td>
                      <td><strong>{cezeriRtp(r.rtp)}</strong></td>
                      <td>{cezeriRtpRange(r.ciLow, r.ciHigh)}</td>
                      <td>{r.featureRate >= 1 ? 'her tur' : `1 / ${int(Math.round(1 / r.featureRate))}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>Her mod için ayrı {int(CEZERI_RTP.standard.rounds / 1_000_000)} milyon tur simülasyonu (motor <code>cezeri-gears-1</code>). RTP ödenen maliyete göre hesaplanır. Kazanç sıklığı (taban dönüş): standart {pct(CEZERI_RTP.standard.hitRate)}, Şans ×2 {pct(CEZERI_RTP.ante.hitRate)}. Oynaklık (maliyet biriminde standart sapma): standart {CEZERI_RTP.standard.stdDev.toFixed(1).replace('.', ',')}, satın alma {CEZERI_RTP.buy.stdDev.toFixed(1).replace('.', ',')}.</p>
          <p className={styles.note}>Simülasyon tahminidir, <strong>sertifikasızdır</strong>; ağır kuyruk nedeniyle güven aralığı iyimser olabilir. Kısa oturumdaki sonuç RTP'den çok farklı olabilir. DEMO kredisi <strong>değersizdir</strong>.</p>
        </div>
      ),
    },
    {
      id: 'limits', title: 'Bahis ve kazanç sınırları',
      content: (
        <div className={styles.page}>
          <h3>Bahis ve kazanç sınırları</h3>
          <dl className={styles.facts}>
            <div><dt>Bahis aralığı</dt><dd>{formatDemo(minBet, { trimZeros: true })} – {formatDemo(maxBet, { trimZeros: true })}</dd></div>
            <div><dt>Basamaklar</dt><dd>{CEZERI_BET_LEVELS_CENTS.map(cents => formatAmount(cents, { trimZeros: true })).join(' · ')}</dd></div>
            <div><dt>Şu anki bahis</dt><dd>{formatDemo(betCents)} · Şans ×2 {formatDemo(cezeriCost(betCents, 'ante'))} · Satın alma {formatDemo(cezeriCost(betCents, 'buy'))}</dd></div>
            <div><dt>Azami kazanç</dt><dd>Bahsin {int(CEZERI_MAX_WIN_MULTIPLIER)} katı · bu bahiste {formatDemo(betCents * CEZERI_MAX_WIN_MULTIPLIER)}</dd></div>
          </dl>
          <p>Azami kazanca ulaşan tur hemen biter; kalan bedava dönüşler oynanmaz. Ödeme her zaman taban bahse göre hesaplanır, kuruşun altı aşağı yuvarlanır.</p>
          <p>Bakiyenin yetmediği basamaklar ve modlar seçilemez. Bir tur tek rezervasyon ve tek ödemedir; aynı anda yalnız bir tur oynanır.</p>
        </div>
      ),
    },
    {
      id: 'keys', title: 'Tuşlar',
      content: (
        <div className={styles.page}>
          <h3>Klavye</h3>
          <dl className={styles.keys}>
            <div><dt><kbd>Boşluk</kbd></dt><dd>Dönüşü başlatır (Ayarlar → "Boşluk tuşuyla döndür"). Tur sürerken dönüşü atlamaz; yalnız bedava dönüş ekranlarını ve kutlama sayacını hızlandırır.</dd></div>
            <div><dt><kbd>Enter</kbd></dt><dd>Odaktaki düğmeye basar.</dd></div>
            <div><dt><kbd>Esc</kbd></dt><dd>Açık pencereyi kapatır (oturum hatırlatması hariç).</dd></div>
            <div><dt><kbd>Tab</kbd></dt><dd>Kontroller arasında gezinir; odak her zaman görünür.</dd></div>
            <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Bu bilgi penceresinde sayfa değiştirir; ayar seçimlerinde seçeneği değiştirir.</dd></div>
          </dl>
          <p className={styles.note}>Ekran okuyucu her adımı ("Işın 4: 3 Fil Saati, göbek ×3", kilitler, göbek çarpanı, tur sonucu) duyurur; tahta 4 halka × 12 dilim olarak okunur. Semboller renk yanında biçimle de ayrılır. Hareketi azalt tercihi dönen halkaları anında yerleştirir, parçacık ve sarsıntıyı kapatır.</p>
        </div>
      ),
    },
    {
      id: 'fault', title: 'Arıza hükmü',
      content: (
        <div className={styles.page}>
          <h3>Arıza hükmü</h3>
          <p><strong>Arıza, etkilenen bütün oyunları ve ödemeleri geçersiz kılar.</strong> Yazılım, tarayıcı veya cihaz arızasında tur kaydı esas alınır; ekranda görünen ama motor kaydıyla uyuşmayan bir tutar geçerli değildir.</p>
          <p>Bu oyun yalnız DEMO kredisiyle oynanır. DEMO değersizdir, paraya veya tokene çevrilemez; arıza halinde DEMO bakiyesi ve oturum geçmişi düzeltilebilir veya sıfırlanabilir.</p>
          <p>Sonuç dönüşten önce belirlendiği için animasyonun yarıda kalması, sekmenin gizlenmesi veya sayfadan ayrılmak sonucu değiştirmez; tur yine motorun ödemesiyle bir kez kapanır.</p>
        </div>
      ),
    },
  ];
}
