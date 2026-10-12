'use client';
import type { ReactNode } from 'react';
import {
  STORM_BET_LEVELS_CENTS, STORM_FREE_SPINS_RETRIGGER, STORM_FREE_SPINS_TRIGGER, STORM_MAX_FREE_SPINS, STORM_MAX_WIN_MULTIPLIER,
  STORM_ORB_WEIGHTS, STORM_PAYTABLE, STORM_RTP, STORM_SCATTER_PAY, type StormMode, type StormPaySymbol,
} from '@sollish/protocol';
import type { GameInfoPage } from '../slot-kit';
import { formatAmount, formatDemo } from '@/lib/slot-kit/bet';
import { STORM_MODE_LABELS, stormCost, stormRtp, stormRtpRange } from '@/lib/storm-controls';
import { stormCents, stormMoney, stormTimes } from '@/lib/storm-timeline';
import { STORM_SYMBOL_LABELS, StormSymbolArt } from './symbols';
import styles from './storm-info.module.css';

const MODES: StormMode[] = ['standard', 'ante', 'buy'];
const ORDER: StormPaySymbol[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4', 'l5'];
const HIGH = new Set<StormPaySymbol>(['h1', 'h2', 'h3', 'h4']);
const TIERS = ['12+', '10–11', '8–9'] as const;
const pct = (ratio: number, digits = 1) => `%${(ratio * 100).toFixed(digits).replace('.', ',')}`;
const int = (n: number) => new Intl.NumberFormat('tr-TR').format(n);
const ORB_TOTAL = STORM_ORB_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);

function Feature({ art, title, children }: { art?: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className={styles.feature}>
      {art && <span className={styles.featureArt} aria-hidden="true">{art}</span>}
      <div><h4>{title}</h4>{children}</div>
    </section>
  );
}

function Paytable({ betCents }: { betCents: number }) {
  const amount = (h: number) => stormMoney(stormCents(betCents, h));
  return (
    <div className={styles.page}>
      <h3>Ödeme tablosu</h3>
      <p className={styles.lead}>Aynı sembolden ızgarada <strong>her yerde 8 veya daha fazla</strong> varsa kazanırsın. Büyük rakam <strong>{formatDemo(betCents)}</strong> bahiste brüt DEMO tutarıdır; altındaki çarpan bahsin katıdır.</p>
      <ul className={styles.payGrid} aria-label="Sembol ödemeleri">
        {ORDER.map(symbol => {
          const [t8, t10, t12] = STORM_PAYTABLE[symbol];
          return (
            <li key={symbol} className={`${styles.payCard} ${HIGH.has(symbol) ? styles.payHigh : ''}`}>
              <span className={styles.payArt} aria-hidden="true"><StormSymbolArt symbol={symbol} size="100%" /></span>
              <div className={styles.payBody}>
                <h4 className={styles.payName}>{STORM_SYMBOL_LABELS[symbol]}</h4>
                <dl className={styles.payRows}>
                  {[t12, t10, t8].map((h, i) => (
                    <div key={TIERS[i]}><dt>{TIERS[i]}</dt><dd><strong>{amount(h)}</strong><small>{stormTimes(h)}×</small></dd></div>
                  ))}
                </dl>
              </div>
            </li>
          );
        })}
      </ul>
      <div className={styles.specials}>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><StormSymbolArt symbol="scatter" size="100%" /></span>
          <div>
            <h4>{STORM_SYMBOL_LABELS.scatter} · dağınık ödeme</h4>
            <dl className={styles.scatterRows}>
              <div><dt>6+ mühür</dt><dd><strong>{amount(STORM_SCATTER_PAY[6])}</strong> <small>{stormTimes(STORM_SCATTER_PAY[6])}×</small></dd></div>
              <div><dt>5 mühür</dt><dd><strong>{amount(STORM_SCATTER_PAY[5])}</strong> <small>{stormTimes(STORM_SCATTER_PAY[5])}×</small></dd></div>
              <div><dt>4 mühür</dt><dd><strong>{amount(STORM_SCATTER_PAY[4])}</strong> <small>{stormTimes(STORM_SCATTER_PAY[4])}×</small></dd></div>
            </dl>
            <p>Temel dönüş bitince ızgarada 4 veya daha fazla mühür varsa öder ve <strong>{STORM_FREE_SPINS_TRIGGER} bedava dönüş</strong> açar. Mühürler patlamaz.</p>
          </div>
        </section>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><StormSymbolArt symbol="orb" multiplier={25} size="100%" /></span>
          <div>
            <h4>{STORM_SYMBOL_LABELS.orb} · çarpan küresi</h4>
            <p>×2 ile ×500 arası değer taşır, hem temel oyunda hem bedava dönüşte düşer. Patlamaz, düşmelerde yerinde kalıp kayar. Ayrıntı "Özellikler" sayfasında.</p>
          </div>
        </section>
        <section className={`${styles.special} ${styles.specialMax}`}>
          <div>
            <h4>Azami kazanç {int(STORM_MAX_WIN_MULTIPLIER)}×</h4>
            <p>Bu bahiste <strong>{formatDemo(betCents * STORM_MAX_WIN_MULTIPLIER)}</strong>. Tur toplamı bu tavana ulaşırsa tur hemen biter; kalan bedava dönüşler oynanmaz.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Multi-page game information (game-standards §3 "Bilgi"). Amounts follow the current bet. */
export function stormInfoPages(betCents: number): GameInfoPage[] {
  const minBet = STORM_BET_LEVELS_CENTS[0]!, maxBet = STORM_BET_LEVELS_CENTS[STORM_BET_LEVELS_CENTS.length - 1]!;
  return [
    {
      id: 'how', title: 'Nasıl oynanır',
      content: (
        <div className={styles.page}>
          <h3>Nasıl oynanır</h3>
          <ol className={styles.steps}>
            <li><strong>Bahsini seç.</strong> − ve + düğmeleri bahsi bir basamak değiştirir; bahis tutarına dokununca bütün basamaklar açılır. "Azami bahis" bakiyenin yettiği en yüksek basamağı seçer.</li>
            <li><strong>Çevir.</strong> Fırtına düğmesine bas veya Boşluk tuşunu kullan. Tur maliyeti (Şans ×2 açıksa bahsin 1,25 katı) bakiyeden bir kez düşer.</li>
            <li><strong>Eşleştir.</strong> 6 sütun × 5 satırlık ızgarada aynı sembolden <strong>her yerde 8 veya daha fazla</strong> varsa kazanırsın; sayı arttıkça ödeme kademesi yükselir.</li>
            <li><strong>Zincir.</strong> Kazanan taşlar parçalanır, üsttekiler düşer, boşluklar yeni taşla dolar. Yeni kazanç kalmayana kadar sürer.</li>
            <li><strong>Yıldırım.</strong> Zincir kazançla bitince Tarhun ızgaradaki her Fırtına Taşına yıldırım atar; taşların değerleri toplanır ve kazanç bu toplamla çarpılır.</li>
            <li><strong>Sonuç.</strong> Turun tamamı dönüş başlamadan önce motorla belirlenir; animasyon yalnızca bu sonucu oynatır. Çevir düğmesi tur (bütün düşmeler ve bedava dönüşler) bitene kadar kilitlidir; hızlandırmak için Hızlı/Turbo ayarını kullan. Hız ayarı, kutlama sayacına dokunmak, gizli sekme veya sayfadan ayrılmak ödemeyi değiştirmez; tur her durumda bir kez, motorun ödemesiyle kapanır.</li>
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
          <Feature title="Düşen taşlar (tumble)" art={<StormSymbolArt symbol="l1" size="100%" />}>
            <p>Her kazançtan sonra kazanan taşlar parçalanır, kalanlar aşağı kayar ve boşluklar üstten dolar. Kazanç göstergesi tur boyunca sıfırlanmaz: düşmeler, çarpanlar ve bütün bedava dönüşler aynı toplamda birikir.</p>
          </Feature>
          <Feature title="Fırtına Taşı (çarpan küresi)" art={<StormSymbolArt symbol="orb" multiplier={100} size="100%" />}>
            <p>Temel oyunda ve bedava dönüşte düşebilir; değeri ×2 ile ×500 arasıdır. Temel oyunda dönüşün düşme zinciri kazançla biterse ızgaradaki taşların değerleri <strong>toplanır</strong> ve o dönüşün kazancı bu toplamla çarpılır (mühür ödemesi çarpılmaz). Kazanç yoksa taşlar etkisiz kalır.</p>
            <ul className={styles.orbRow} aria-label="Fırtına Taşı değerleri ve olasılıkları">
              {STORM_ORB_WEIGHTS.map(([value, weight]) => (
                <li key={value}><span aria-hidden="true"><StormSymbolArt symbol="orb" multiplier={value} size="100%" /></span><strong>×{value}</strong><small>{pct(weight / ORB_TOTAL, weight / ORB_TOTAL < 0.001 ? 3 : 1)}</small></li>
              ))}
            </ul>
          </Feature>
          <Feature title="Toplam çarpan (bedava dönüş)" art={<StormSymbolArt symbol="orb" multiplier={250} size="100%" />}>
            <p>Bedava dönüşler <strong>×0 toplam çarpanla</strong> başlar. Kazanan her dönüşte ızgaradaki Fırtına Taşlarının değerleri toplam çarpana <strong>eklenir</strong>, sonra o dönüşün kazancı yeni toplamla çarpılır (toplam henüz 0 ise ×1). Kazançsız dönüşte taşlar eklenmez. Toplam çarpan bedava dönüşler boyunca, ek dönüşler dahil, korunur.</p>
          </Feature>
          <Feature title="Şimşek Mührü (scatter)" art={<StormSymbolArt symbol="scatter" size="100%" />}>
            <p>Temel dönüş bitince 4 veya daha fazla mühür ödeme yapar ve {STORM_FREE_SPINS_TRIGGER} bedava dönüş açar. Bedava dönüşte 3 veya daha fazla mühür {STORM_FREE_SPINS_RETRIGGER} dönüş daha ekler (ödemesiz). Bir turda en çok {STORM_MAX_FREE_SPINS} bedava dönüş verilir.</p>
          </Feature>
          <Feature title="Bedava dönüş">
            <p>Bedava dönüşler aynı bahisle, aynı tur içinde oynanır; ek ücret alınmaz. Her zaman "Fırtına Dindi — Toplam" ekranıyla biter: oynanan dönüş, son toplam çarpan ve toplam kazanç.</p>
          </Feature>
          <Feature title="Kazanç kademeleri ve çarpan anonsu">
            <p>Tur toplamı taban bahsin <strong>10 katı</strong> veya üstüyse kutlama ekranı açılır ve sayaç kademeler arasında tırmanır: Büyük Kazanç ≥10×, Mega Kazanç ≥25×, Süper Kazanç ≥50×, Efsane Kazanç ≥100×; tavana ulaşan tur Azami Kazanç ile biter. Uygulanan her çarpan ızgaranın üstünde büyük yazıyla duyurulur; ×10, ×25, ×50, ×100, ×250 ve ×500 eşiklerinde yazı ve ses büyür. Ekrana dokunmak sayacı hemen sonuca getirir; ödemeyi değiştirmez.</p>
          </Feature>
          <Feature title={`Şans ×2 · maliyet ${formatDemo(stormCost(betCents, 'ante'))}`}>
            <p>Açıkken her dönüş bahsin <strong>1,25 katına</strong> mal olur ve temel oyunda mühür çıkma olasılığı artar: bedava dönüş şansı yaklaşık 2 katıdır ({pct(STORM_RTP.ante.featureRate, 2)} / {pct(STORM_RTP.standard.featureRate, 2)}). Kazançlar yine taban bahse göre ödenir. Açıkken bonus satın alınamaz.</p>
          </Feature>
          <Feature title={`Bonus satın al · fiyat ${formatDemo(stormCost(betCents, 'buy'))}`}>
            <p>Bahsin <strong>100 katı</strong> karşılığında tur en az 4 mühürle başlar; {STORM_FREE_SPINS_TRIGGER} bedava dönüş garantilidir. Satın alma onay penceresiyle yapılır, ayrı bir RTP ile çalışır ({stormRtp(STORM_RTP.buy.rtp)}) ve otomatik oyunla kullanılamaz.</p>
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
                  const r = STORM_RTP[mode];
                  return (
                    <tr key={mode}>
                      <th scope="row">{STORM_MODE_LABELS[mode]}</th>
                      <td>{mode === 'standard' ? '×1' : mode === 'ante' ? '×1,25' : '×100'}</td>
                      <td><strong>{stormRtp(r.rtp)}</strong></td>
                      <td>{stormRtpRange(r.ciLow, r.ciHigh)}</td>
                      <td>{r.featureRate >= 1 ? 'her tur' : `1 / ${int(Math.round(1 / r.featureRate))}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>Her mod için ayrı {int(STORM_RTP.standard.rounds / 1_000_000)} milyon tur simülasyonu (motor <code>storm-throne-1</code>). RTP ödenen maliyete göre hesaplanır. Kazanç sıklığı (taban dönüş): standart {pct(STORM_RTP.standard.hitRate)}, Şans ×2 {pct(STORM_RTP.ante.hitRate)}. Oynaklık (maliyet biriminde standart sapma): standart {STORM_RTP.standard.stdDev.toFixed(1).replace('.', ',')}, satın alma {STORM_RTP.buy.stdDev.toFixed(1).replace('.', ',')}.</p>
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
            <div><dt>Basamaklar</dt><dd>{STORM_BET_LEVELS_CENTS.map(cents => formatAmount(cents, { trimZeros: true })).join(' · ')}</dd></div>
            <div><dt>Şu anki bahis</dt><dd>{formatDemo(betCents)} · Şans ×2 {formatDemo(stormCost(betCents, 'ante'))} · Satın alma {formatDemo(stormCost(betCents, 'buy'))}</dd></div>
            <div><dt>Azami kazanç</dt><dd>Bahsin {int(STORM_MAX_WIN_MULTIPLIER)} katı · bu bahiste {formatDemo(betCents * STORM_MAX_WIN_MULTIPLIER)}</dd></div>
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
            <div><dt><kbd>PageUp</kbd> <kbd>PageDown</kbd></dt><dd>Bilgi sayfaları arasında gezinir.</dd></div>
          </dl>
          <p className={styles.note}>Ekran okuyucu her adımı ("8 altın boğa ritonu, 9,60× kazanç", çarpanlar, tur sonucu) duyurur; ızgara 6×5 tablo olarak okunur. Semboller renk yanında biçim ve işaretle de ayrılır. Hareketi azalt tercihi parçacık, şimşek ve sarsıntıyı kapatır.</p>
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
