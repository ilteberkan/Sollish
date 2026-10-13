'use client';
import type { CSSProperties, ReactNode } from 'react';
import {
  EBRU_BET_LEVELS_CENTS, EBRU_CLUSTER_TIER_STARTS, EBRU_COLOURS, EBRU_COMB_AMPLITUDE_WEIGHTS, EBRU_FREE_SPINS_RETRIGGER, EBRU_FREE_SPINS_TRIGGER,
  EBRU_MAX_COMB_PASSES, EBRU_MAX_FREE_SPINS, EBRU_MAX_WIN_MULTIPLIER, EBRU_PAYTABLE, EBRU_RTP, EBRU_SCATTER_PAY, EBRU_SIN_TABLE, EBRU_STAIN_MAX,
  type EbruColour, type EbruMode,
} from '@sollish/protocol';
import type { GameInfoPage } from '../slot-kit';
import { formatAmount, formatDemo } from '@/lib/slot-kit/bet';
import { EBRU_MODE_LABELS, ebruCost, ebruRtp, ebruRtpRange } from '@/lib/ebru-controls';
import { ebruCents, ebruMoney, ebruTimes } from '@/lib/ebru-timeline';
import { EBRU_STAIN_VALUES, EBRU_SYMBOL_LABELS, EbruStainArt, EbruSymbolArt } from './symbols';
import { EBRU_INKS } from './water';
import styles from './ebru-info.module.css';

const MODES: EbruMode[] = ['standard', 'ante', 'buy'];
const HIGH = new Set<EbruColour>(['c1', 'c2', 'c3']);
/** Labels of EBRU_CLUSTER_TIER_STARTS: 5, 6, 7, 8, 9, 10–11, 12–13, …, 33+. */
const TIER_LABELS = EBRU_CLUSTER_TIER_STARTS.map((start, i) => {
  const next = EBRU_CLUSTER_TIER_STARTS[i + 1];
  if (next === undefined) return `${start}+`;
  return next - 1 === start ? `${start}` : `${start}–${next - 1}`;
});
/** Tiers shown on the cards (5, 8, 12–13, 17–20, 26–32, 33+); the full table lists all twelve. */
const CARD_TIERS = [11, 9, 6, 3, 0];
const pct = (ratio: number, digits = 1) => `%${(ratio * 100).toFixed(digits).replace('.', ',')}`;
const int = (n: number) => new Intl.NumberFormat('tr-TR').format(n);
const AMP_TOTAL = EBRU_COMB_AMPLITUDE_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
/** The engine's comb formula for the worked example on the features page. */
const exampleShifts = (a: number, p: number, q: number) => Array.from({ length: 7 }, (_, r) => {
  const n = a * EBRU_SIN_TABLE[(p + r * q) % 64]!;
  const m = Math.floor((2 * Math.abs(n) + 1000) / 2000);
  return n < 0 ? -m : m;
});
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

function Feature({ art, title, children }: { art?: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className={styles.feature}>
      {art && <span className={styles.featureArt} aria-hidden="true">{art}</span>}
      <div><h4>{title}</h4>{children}</div>
    </section>
  );
}

function Paytable({ betCents }: { betCents: number }) {
  const amount = (h: number) => ebruMoney(ebruCents(betCents, h));
  return (
    <div className={styles.page}>
      <h3>Ödeme tablosu</h3>
      <p className={styles.lead}>Yatay veya dikey komşu <strong>5 veya daha fazla aynı renk</strong> damla bir küme oluşturur. Büyük rakam <strong>{formatDemo(betCents)}</strong> bahiste brüt DEMO tutarıdır; altındaki çarpan bahsin katıdır. Aynı ızgaradaki bütün kümeler ayrı ayrı öder.</p>
      <ul className={styles.payGrid} aria-label="Küme ödemeleri">
        {EBRU_COLOURS.map(colour => (
          <li key={colour} className={`${styles.payCard} ${HIGH.has(colour) ? styles.payHigh : ''}`}>
            <span className={styles.payArt} aria-hidden="true"><EbruSymbolArt symbol={colour} size="100%" /></span>
            <div className={styles.payBody}>
              <h4 className={styles.payName}>{EBRU_SYMBOL_LABELS[colour]}</h4>
              <dl className={styles.payRows}>
                {CARD_TIERS.map(tier => (
                  <div key={tier}><dt>{TIER_LABELS[tier]}</dt><dd><strong>{amount(EBRU_PAYTABLE[colour][tier]!)}</strong><small>{ebruTimes(EBRU_PAYTABLE[colour][tier]!)}×</small></dd></div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
      <details className={styles.fullTable}>
        <summary>Bütün küme boyları (12 kademe)</summary>
        <table>
          <caption className="sr-only">Renk ve küme boyuna göre ödeme, bahsin katı</caption>
          <thead><tr><th scope="col">Renk</th>{TIER_LABELS.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>
            {EBRU_COLOURS.map(colour => (
              <tr key={colour}>
                <th scope="row"><span aria-hidden="true"><EbruSymbolArt symbol={colour} size="100%" /></span>{EBRU_SYMBOL_LABELS[colour]}</th>
                {EBRU_PAYTABLE[colour].map((h, i) => <td key={i}>{ebruTimes(h)}×</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <div className={styles.specials}>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><EbruSymbolArt symbol="comb" size="100%" /></span>
          <div>
            <h4>{EBRU_SYMBOL_LABELS.comb} · dağınık ödeme</h4>
            <dl className={styles.scatterRows}>
              <div><dt>5+ tarak</dt><dd><strong>{amount(EBRU_SCATTER_PAY[5])}</strong> <small>{ebruTimes(EBRU_SCATTER_PAY[5])}×</small></dd></div>
              <div><dt>4 tarak</dt><dd><strong>{amount(EBRU_SCATTER_PAY[4])}</strong> <small>{ebruTimes(EBRU_SCATTER_PAY[4])}×</small></dd></div>
              <div><dt>3 tarak</dt><dd><strong>{amount(EBRU_SCATTER_PAY[3])}</strong> <small>{ebruTimes(EBRU_SCATTER_PAY[3])}×</small></dd></div>
            </dl>
            <p>Temel dönüşün son ızgarasında 3 veya daha fazla Altın Tarak varsa öder ve <strong>{EBRU_FREE_SPINS_TRIGGER} bedava dönüş</strong> (Lale Ebrusu) açar. Taraklar dağılmaz; yalnız düşer ve tarakla kayar.</p>
          </div>
        </section>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><EbruSymbolArt symbol="drop" size="100%" /></span>
          <div>
            <h4>{EBRU_SYMBOL_LABELS.drop}</h4>
            <p>Kendisi kümeye girmez; düştüğü yerde mürekkebini yayar: 4 komşusu arasında en sık görülen rengi seçer, komşularını ve kendini o renge boyar. Ayrıntı "Özellikler" sayfasında.</p>
          </div>
        </section>
        <section className={`${styles.special} ${styles.specialMax}`}>
          <div>
            <h4>Azami kazanç {int(EBRU_MAX_WIN_MULTIPLIER)}×</h4>
            <p>Bu bahiste <strong>{formatDemo(betCents * EBRU_MAX_WIN_MULTIPLIER)}</strong>. Tur toplamı bu tavana ulaşırsa tur hemen biter; kalan bedava dönüşler oynanmaz.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function CombExample() {
  const shifts = exampleShifts(2, 0, 8);
  const colours = EBRU_COLOURS.slice(0, 7);
  return (
    <>
      <p>Örnek: A = 2, φ = 0, k = 8·2π/64 → satır kaymaları {shifts.map(signed).join(', ')}.</p>
      <dl className={styles.combDemo} aria-label="Örnek tarak geçişi, satır başına kayma">
        {shifts.map((s, r) => (
          <div key={r} style={{ display: 'contents' }}>
            <dt>{r + 1}. satır {signed(s)}</dt>
            <dd aria-hidden="true">{colours.map((_, c) => { const from = (((c - s) % 7) + 7) % 7; return <span key={c} data-c="" style={{ '--c': EBRU_INKS[colours[(from + r) % 7]!].base } as CSSProperties} />; })}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** Multi-page game information (game-standards §3 "Bilgi"). Amounts follow the current bet. */
export function ebruInfoPages(betCents: number): GameInfoPage[] {
  const minBet = EBRU_BET_LEVELS_CENTS[0]!, maxBet = EBRU_BET_LEVELS_CENTS[EBRU_BET_LEVELS_CENTS.length - 1]!;
  return [
    {
      id: 'how', title: 'Nasıl oynanır',
      content: (
        <div className={styles.page}>
          <h3>Nasıl oynanır</h3>
          <ol className={styles.steps}>
            <li><strong>Bahsini seç.</strong> − ve + düğmeleri bahsi bir basamak değiştirir; bahis tutarına dokununca bütün basamaklar açılır. "Azami bahis" bakiyenin yettiği en yüksek basamağı seçer.</li>
            <li><strong>Çevir.</strong> Mürekkep düğmesine bas veya Boşluk tuşunu kullan. Tur maliyeti (Şans ×2 açıksa bahsin 1,25 katı) bakiyeden bir kez düşer.</li>
            <li><strong>Küme kur.</strong> 7 × 7 su teknesinde yatay veya dikey komşu <strong>5 veya daha fazla aynı renk</strong> damla öder; küme büyüdükçe ödeme kademesi yükselir.</li>
            <li><strong>Zincir.</strong> Kazanan kümeler suya dağılır, üsttekiler düşer, boşluklar yeni damlayla dolar; yeni küme kalmayana kadar sürer.</li>
            <li><strong>Tarak.</strong> Zincir bitince — kazanç olmasa bile — Altın Tarak suyu tarar: her satır kendi kadar sağa veya sola kayar ve yeni kümeler doğabilir. Dönüş başına en çok {EBRU_MAX_COMB_PASSES} tarak geçişi.</li>
            <li><strong>Sonuç.</strong> Turun tamamı dönüş başlamadan önce motorla belirlenir; animasyon yalnızca bu sonucu oynatır. Çevir düğmesi tur (bütün düşmeler, tarak geçişleri ve bedava dönüşler) bitene kadar kilitlidir; hızlandırmak için Hızlı/Turbo ayarını kullan. Hız ayarı, kutlama sayacına dokunmak, gizli sekme veya sayfadan ayrılmak ödemeyi değiştirmez; tur her durumda bir kez, motorun ödemesiyle kapanır.</li>
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
          <Feature title="Tarak geçişi" art={<EbruSymbolArt symbol="comb" size="100%" />}>
            <p>Her düşme zinciri bittiğinde tarak tahtayı bir kez tarar: r. satır <strong>round(A · sin(φ + r · k))</strong> sütun dairesel kayar (sağdan çıkan soldan girer). A her geçişte 1, 2 veya 3 olur ({EBRU_COMB_AMPLITUDE_WEIGHTS.map(([a, w]) => `${a}: ${pct(w / AMP_TOTAL, 0)}`).join(', ')}); φ ve k da her geçişte yeniden çekilir. Kayma yeni bir küme kurarsa zincir sürer; kurmazsa dönüş biter. Dönüş başına en çok {EBRU_MAX_COMB_PASSES} geçiş. Semboller yalnız yer değiştirir; hiçbiri eklenmez veya silinmez.</p>
            <CombExample />
          </Feature>
          <Feature title="Usta Damlası (joker)" art={<EbruSymbolArt symbol="drop" size="100%" />}>
            <p>Düştüğü anda (dağıtımda veya dolumda) mürekkebini yayar: 4 komşusunun renklerini sayar, en sık rengi seçer (eşitlikte rastgele, renkli komşu yoksa rastgele bir renk), renkli komşularını o renge boyar ve kendisi de o renk olur. Altın Taraklar boyanmaz.</p>
          </Feature>
          <Feature title="Lale Ebrusu (bedava dönüş)" art={<EbruStainArt value={16} size="100%" />}>
            <p>3+ Altın Tarak {EBRU_FREE_SPINS_TRIGGER} bedava dönüş açar. Bedava dönüşte patlayan her hücreye <strong>boya lekesi çarpanı</strong> düşer: ilk kez ×2, aynı hücrede her seferinde iki katı, en çok ×{EBRU_STAIN_MAX}. Lekeler özellik boyunca kalır; düşmeler onları taşımaz ama <strong>tarak geçişi lekeleri sembollerle aynı kaymayla tarar</strong>. Bir küme lekeli hücrelerden geçerse ödemesi altındaki lekelerin <strong>toplamıyla</strong> çarpılır (önce ödeme, sonra yeni leke). Bedava dönüşte 3+ tarak {EBRU_FREE_SPINS_RETRIGGER} dönüş ekler; bir turda en çok {EBRU_MAX_FREE_SPINS} dönüş. Bedava dönüşte İs Damlası dağıtılmaz (yalnız renkli komşusu olmayan bir Usta Damlası rastgele bu rengi seçebilir).</p>
            <ul className={styles.stainRow} aria-label="Leke çarpanları">{EBRU_STAIN_VALUES.map(v => <li key={v}><EbruStainArt value={v} size="100%" /></li>)}</ul>
          </Feature>
          <Feature title="Birikimli kazanç">
            <p>Kazanç göstergesi tur boyunca sıfırlanmaz: kümeler, tarak kazançları, dağınık ödeme ve bütün bedava dönüşler aynı toplamda birikir. Bedava dönüş turu her zaman "Lale Ebrusu — Toplam" ekranıyla biter.</p>
          </Feature>
          <Feature title="Kazanç kademeleri ve çarpan anonsu">
            <p>Tur toplamı taban bahsin <strong>10 katı</strong> veya üstüyse kutlama ekranı açılır ve sayaç kademeler arasında tırmanır: Büyük Kazanç ≥10×, Mega Kazanç ≥25×, Süper Kazanç ≥50×, Efsane Kazanç ≥100×; tavana ulaşan tur Azami Kazanç ile biter. ×10 ve üstü leke çarpanı ızgaranın üstünde büyük yazıyla ve kendi sesiyle duyurulur. Ekrana dokunmak sayacı hemen sonuca getirir; ödemeyi değiştirmez.</p>
          </Feature>
          <Feature title={`Şans ×2 · maliyet ${formatDemo(ebruCost(betCents, 'ante'))}`}>
            <p>Açıkken her dönüş bahsin <strong>1,25 katına</strong> mal olur ve temel oyunda Altın Tarak çıkma olasılığı artar: bedava dönüş şansı yaklaşık 2 katıdır ({pct(EBRU_RTP.ante.featureRate, 2)} / {pct(EBRU_RTP.standard.featureRate, 2)}). Kazançlar yine taban bahse göre ödenir. Açıkken bonus satın alınamaz.</p>
          </Feature>
          <Feature title={`Bonus satın al · fiyat ${formatDemo(ebruCost(betCents, 'buy'))}`}>
            <p>Bahsin <strong>100 katı</strong> karşılığında tur en az 3 Altın Tarakla başlar; {EBRU_FREE_SPINS_TRIGGER} bedava dönüş garantilidir. Satın alma onay penceresiyle yapılır, ayrı bir RTP ile çalışır ({ebruRtp(EBRU_RTP.buy.rtp)}) ve otomatik oyunla kullanılamaz.</p>
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
                  const r = EBRU_RTP[mode];
                  return (
                    <tr key={mode}>
                      <th scope="row">{EBRU_MODE_LABELS[mode]}</th>
                      <td>{mode === 'standard' ? '×1' : mode === 'ante' ? '×1,25' : '×100'}</td>
                      <td><strong>{ebruRtp(r.rtp)}</strong></td>
                      <td>{ebruRtpRange(r.ciLow, r.ciHigh)}</td>
                      <td>{r.featureRate >= 1 ? 'her tur' : `1 / ${int(Math.round(1 / r.featureRate))}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>Her mod için ayrı {int(EBRU_RTP.standard.rounds / 1_000_000)} milyon tur simülasyonu (motor <code>ebru-ink-1</code>). RTP ödenen maliyete göre hesaplanır. Kazanç sıklığı (taban dönüş): standart {pct(EBRU_RTP.standard.hitRate)}, Şans ×2 {pct(EBRU_RTP.ante.hitRate)}. Oynaklık (maliyet biriminde standart sapma): standart {EBRU_RTP.standard.stdDev.toFixed(1).replace('.', ',')}, satın alma {EBRU_RTP.buy.stdDev.toFixed(1).replace('.', ',')}.</p>
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
            <div><dt>Basamaklar</dt><dd>{EBRU_BET_LEVELS_CENTS.map(cents => formatAmount(cents, { trimZeros: true })).join(' · ')}</dd></div>
            <div><dt>Şu anki bahis</dt><dd>{formatDemo(betCents)} · Şans ×2 {formatDemo(ebruCost(betCents, 'ante'))} · Satın alma {formatDemo(ebruCost(betCents, 'buy'))}</dd></div>
            <div><dt>Azami kazanç</dt><dd>Bahsin {int(EBRU_MAX_WIN_MULTIPLIER)} katı · bu bahiste {formatDemo(betCents * EBRU_MAX_WIN_MULTIPLIER)}</dd></div>
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
          <p className={styles.note}>Ekran okuyucu her adımı ("6 altın lale, leke ×4, 12,00× kazanç", tarak geçişleri, tur sonucu) duyurur; ızgara 7×7 tablo olarak okunur ve lekeli hücreler çarpanıyla birlikte söylenir. Semboller renk yanında biçimle de ayrılır (lale, karanfil, hatip, yaprak, tavus gözü, papatya, gül, çakıl). Hareketi azalt tercihi tarağı kısa bir kaydırmaya indirir, parçacıkları ve sarsıntıyı kapatır.</p>
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
