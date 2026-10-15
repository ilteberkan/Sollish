'use client';
import type { ReactNode } from 'react';
import {
  ASENA_BET_LEVELS_CENTS, ASENA_FREE_SPINS_RETRIGGER, ASENA_FREE_SPINS_TRIGGER, ASENA_MAP_MULTIPLIERS, ASENA_MAP_SPINS_AT_3, ASENA_MAP_SPINS_AT_6,
  ASENA_MAX_FREE_SPINS, ASENA_MAX_WIN_MULTIPLIER, ASENA_PAY_SYMBOLS, ASENA_PAYTABLE, ASENA_RTP, ASENA_SCATTER_PAY, ASENA_TEMPLATES,
  type AsenaMode, type AsenaPaySymbol,
} from '@sollish/protocol';
import type { GameInfoPage } from '../slot-kit';
import { formatAmount, formatDemo } from '@/lib/slot-kit/bet';
import { ASENA_MODE_LABELS, asenaCost, asenaRtp, asenaRtpRange } from '@/lib/asena-controls';
import { asenaCents, asenaMoney, asenaTimes } from '@/lib/asena-timeline';
import { ASENA_SYMBOL_LABELS, AsenaSymbolArt } from './symbols';
import { AsenaTemplateGlyph } from './template-glyph';
import styles from './asena-info.module.css';

const MODES: AsenaMode[] = ['standard', 'ante', 'buy'];
const HIGH = new Set<AsenaPaySymbol>(['h1', 'h2', 'h3', 'h4']);
/** Cluster-size tiers of the engine (asenaTier): 5, 6, 7, 8–9, 10–12, 13–17, 18+. */
const TIER_LABELS = ['5', '6', '7', '8–9', '10–12', '13–17', '18+'] as const;
/** Tiers shown on the cards (18+, 13–17, 10–12, 8–9, 5); the full table lists all seven. */
const CARD_TIERS = [6, 5, 4, 3, 0];
const pct = (ratio: number, digits = 1) => `%${(ratio * 100).toFixed(digits).replace('.', ',')}`;
const int = (n: number) => new Intl.NumberFormat('tr-TR').format(n);
const BY_MULTIPLIER = [...ASENA_TEMPLATES].sort((a, b) => b.multiplier - a.multiplier);

function Feature({ art, title, children }: { art?: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className={styles.feature}>
      {art && <span className={styles.featureArt} aria-hidden="true">{art}</span>}
      <div><h4>{title}</h4>{children}</div>
    </section>
  );
}

function Paytable({ betCents }: { betCents: number }) {
  const amount = (h: number) => asenaMoney(asenaCents(betCents, h));
  return (
    <div className={styles.page}>
      <h3>Ödeme tablosu</h3>
      <p className={styles.lead}>Yatay veya dikey komşu <strong>5 veya daha fazla aynı sembol</strong> bir küme oluşturur; Gök Kurt ve Yıldız İzi jokerleri her sembolün yerine geçer. Büyük rakam <strong>{formatDemo(betCents)}</strong> bahiste brüt DEMO tutarıdır; altındaki çarpan bahsin katıdır. Aynı tahtadaki bütün kümeler ayrı ayrı öder.</p>
      <ul className={styles.payGrid} aria-label="Küme ödemeleri">
        {ASENA_PAY_SYMBOLS.map(symbol => (
          <li key={symbol} className={`${styles.payCard} ${HIGH.has(symbol) ? styles.payHigh : ''}`}>
            <span className={styles.payArt} aria-hidden="true"><AsenaSymbolArt symbol={symbol} size="100%" /></span>
            <div className={styles.payBody}>
              <h4 className={styles.payName}>{ASENA_SYMBOL_LABELS[symbol]}</h4>
              <dl className={styles.payRows}>
                {CARD_TIERS.map(tier => (
                  <div key={tier}><dt>{TIER_LABELS[tier]}</dt><dd><strong>{amount(ASENA_PAYTABLE[symbol][tier]!)}</strong><small>{asenaTimes(ASENA_PAYTABLE[symbol][tier]!)}×</small></dd></div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
      <details className={styles.fullTable}>
        <summary>Bütün küme boyları (7 kademe)</summary>
        <table>
          <caption className="sr-only">Sembol ve küme boyuna göre ödeme, bahsin katı</caption>
          <thead><tr><th scope="col">Sembol</th>{TIER_LABELS.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>
            {ASENA_PAY_SYMBOLS.map(symbol => (
              <tr key={symbol}>
                <th scope="row"><span aria-hidden="true"><AsenaSymbolArt symbol={symbol} size="100%" /></span>{ASENA_SYMBOL_LABELS[symbol]}</th>
                {ASENA_PAYTABLE[symbol].map((h, i) => <td key={i}>{asenaTimes(h)}×</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <div className={styles.specials}>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><AsenaSymbolArt symbol="moon" size="100%" /></span>
          <div>
            <h4>{ASENA_SYMBOL_LABELS.moon}</h4>
            <dl className={styles.scatterRows}>
              <div><dt>5+ Ay Ata</dt><dd><strong>{amount(ASENA_SCATTER_PAY[5])}</strong> <small>{asenaTimes(ASENA_SCATTER_PAY[5])}×</small></dd></div>
              <div><dt>4 Ay Ata</dt><dd><strong>{amount(ASENA_SCATTER_PAY[4])}</strong> <small>{asenaTimes(ASENA_SCATTER_PAY[4])}×</small></dd></div>
              <div><dt>3 Ay Ata</dt><dd><strong>{amount(ASENA_SCATTER_PAY[3])}</strong> <small>{asenaTimes(ASENA_SCATTER_PAY[3])}×</small></dd></div>
            </dl>
            <p>Temel dönüşün son tahtasında 3 veya daha fazla Ay Ata varsa öder ve <strong>{ASENA_FREE_SPINS_TRIGGER} bedava dönüş</strong> (Ergenekon) açar. Ay Ata patlamaz; kurt da üstüne basmaz.</p>
          </div>
        </section>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><AsenaSymbolArt symbol="wolf" size="100%" /></span>
          <div>
            <h4>{ASENA_SYMBOL_LABELS.wolf}</h4>
            <p>Her ödeme sembolünün yerine geçer ve yalnız dönüşün ilk tahtasında gelir. Bir kazanca katılırsa patlamaz, <strong>yürür</strong>: düşmeden sonra bir hücre ilerler ve ayrıldığı hücreye Yıldız İzi bırakır. Ayrıntı "Özellikler" sayfasında.</p>
          </div>
        </section>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><AsenaSymbolArt symbol="trail" size="100%" /></span>
          <div>
            <h4>{ASENA_SYMBOL_LABELS.trail}</h4>
            <p>Kurdun ardında kalan joker. Düşmelerle birlikte iner ve bir kazanca katılınca harcanır; dönüş bitince silinir, sonraki dönüşe geçmez.</p>
          </div>
        </section>
        <section className={`${styles.special} ${styles.specialMax}`}>
          <div>
            <h4>Azami kazanç {int(ASENA_MAX_WIN_MULTIPLIER)}×</h4>
            <p>Bu bahiste <strong>{formatDemo(betCents * ASENA_MAX_WIN_MULTIPLIER)}</strong>. Tur toplamı bu tavana ulaşırsa tur hemen biter; kalan bedava dönüşler oynanmaz.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Multi-page game information (game-standards §3 "Bilgi"). Amounts follow the current bet. */
export function asenaInfoPages(betCents: number): GameInfoPage[] {
  const minBet = ASENA_BET_LEVELS_CENTS[0]!, maxBet = ASENA_BET_LEVELS_CENTS[ASENA_BET_LEVELS_CENTS.length - 1]!;
  return [
    {
      id: 'how', title: 'Nasıl oynanır',
      content: (
        <div className={styles.page}>
          <h3>Nasıl oynanır</h3>
          <ol className={styles.steps}>
            <li><strong>Bahsini seç.</strong> − ve + düğmeleri bahsi bir basamak değiştirir; bahis tutarına dokununca bütün basamaklar açılır. "Azami bahis" bakiyenin yettiği en yüksek basamağı seçer.</li>
            <li><strong>Çevir.</strong> Yıldız düğmesine bas veya Boşluk tuşunu kullan. Tur maliyeti (Şans ×2 açıksa bahsin 1,25 katı) bakiyeden bir kez düşer.</li>
            <li><strong>Küme kur.</strong> 6 × 6 yıldız alanında yatay veya dikey komşu <strong>5 veya daha fazla aynı sembol</strong> öder; küme büyüdükçe ödeme kademesi yükselir.</li>
            <li><strong>Takımyıldız.</strong> Küme gökteki altı şablondan birini içeriyorsa takımyıldız yıldız yıldız çizilir, gökte yankılanır, kurt uluyor ve küme ödemesi şablonun çarpanıyla (×2–×10) çarpılır.</li>
            <li><strong>Zincir.</strong> Kazanan kümeler yıldıza dönüşüp patlar, üsttekiler düşer, boşluklar dolar; kazanca katılan Gök Kurt bir hücre yürür. Yeni küme kalmayana kadar sürer.</li>
            <li><strong>Sonuç.</strong> Turun tamamı dönüş başlamadan önce motorla belirlenir; animasyon yalnızca bu sonucu oynatır. Çevir düğmesi tur (bütün düşmeler, kurt adımları ve bedava dönüşler) bitene kadar kilitlidir; hızlandırmak için Hızlı/Turbo ayarını kullan. Hız ayarı, kutlama sayacına dokunmak, gizli sekme veya sayfadan ayrılmak ödemeyi değiştirmez; tur her durumda bir kez, motorun ödemesiyle kapanır.</li>
          </ol>
          <p className={styles.note}>DEMO kredisi değersizdir; SOL, token veya ödül kazandırmaz. Oyun tarayıcıda yerel rastgelelikle çalışır, VRF kanıtı yoktur. Gök Tengri, Ay Ata, Kün Ana, Asena ve Ergenekon kamu malı Türk mitolojisidir; karakterler ve çizimler özgündür.</p>
        </div>
      ),
    },
    { id: 'pay', title: 'Ödeme tablosu', content: <Paytable betCents={betCents} /> },
    {
      id: 'features', title: 'Özellikler',
      content: (
        <div className={styles.page}>
          <h3>Özellikler</h3>
          <Feature title="Takımyıldız şablonları">
            <p>Kazanan bir küme aşağıdaki şekillerden birini — döndürülmüş veya yansıtılmış hâli dahil, 8 yönün herhangi biri — tamamen içeriyorsa takımyıldız tutuşur ve <strong>küme ödemesi şablonun çarpanıyla çarpılır</strong>. Jokerler kümenin hücresidir. Birden çok şablon sığarsa çarpanı en yüksek olan tutuşur; her küme en çok bir takımyıldız yakar, aynı adımdaki farklı kümeler ayrı takımyıldızlar yakabilir.</p>
            <ul className={styles.templates} aria-label="Takımyıldız şablonları">
              {BY_MULTIPLIER.map(t => (
                <li key={t.id}>
                  <AsenaTemplateGlyph id={t.id} className={styles.templateArt} />
                  <span><strong>{t.name}</strong><small>{t.cells.length} yıldız</small></span>
                  <b>×{t.multiplier}</b>
                </li>
              ))}
            </ul>
          </Feature>
          <Feature title="Gök Kurt yürür" art={<AsenaSymbolArt symbol="wolf" size="100%" />}>
            <p>Bir kazanca katılan kurt patlamaz. Düşme ve dolumdan sonra bir hücre yürür (yukarı, sağ, aşağı veya sol; rastgele, tahtadan çıkmaz, Ay Ata’ya ve başka kurda basmaz). Girdiği hücredeki sembolü yutar, ayrıldığı hücrede bir <strong>Yıldız İzi</strong> jokeri bırakır. Birden çok kurt sırayla yürür. Yıldız İzi bir kazanca katılınca harcanır; dönüş bitince silinir.</p>
          </Feature>
          <Feature title="Ergenekon (bedava dönüş)" art={<AsenaSymbolArt symbol="moon" size="100%" />}>
            <p>3+ Ay Ata {ASENA_FREE_SPINS_TRIGGER} bedava dönüş açar (bedava dönüşte 3+ Ay Ata +{ASENA_FREE_SPINS_RETRIGGER}; bir turda en çok {ASENA_MAX_FREE_SPINS} dönüş). Bedava dönüşte yanan her takımyıldız <strong>Ergenekon haritasında</strong> kendi parçasını açar (bir parça en çok iki kez sayılır):</p>
            <ol className={styles.mapSteps}>
              <li><b>3 farklı takımyıldız</b> → +{ASENA_MAP_SPINS_AT_3} dönüş ve genel çarpan <strong>×{ASENA_MAP_MULTIPLIERS[3]}</strong></li>
              <li><b>6 farklı takımyıldız</b> → +{ASENA_MAP_SPINS_AT_6} dönüş ve genel çarpan <strong>×{ASENA_MAP_MULTIPLIERS[6]}</strong></li>
              <li><b>Altısı da iki kez</b> → genel çarpan <strong>×{ASENA_MAP_MULTIPLIERS.twice}</strong> (demir dağ yarılır)</li>
            </ol>
            <p>Genel çarpan ve harita özellik boyunca kalır, hiç sıfırlanmaz ve <strong>her küme kazancını</strong> çarpar — açıldığı adımın kazancı dahil (önce takımyıldızlar haritaya işlenir, sonra adım öder). Temel oyun her zaman ×1 ile oynanır.</p>
          </Feature>
          <Feature title="Birikimli kazanç">
            <p>Kazanç göstergesi tur boyunca sıfırlanmaz: kümeler, Ay Ata ödemesi ve bütün bedava dönüşler aynı toplamda birikir. Bedava dönüş turu her zaman "Ergenekon — Toplam" ekranıyla biter.</p>
          </Feature>
          <Feature title="Kazanç kademeleri ve çarpan anonsu">
            <p>Tur toplamı taban bahsin <strong>10 katı</strong> veya üstüyse gök kapısı açılır ve sayaç kademeler arasında tırmanır: Büyük Kazanç ≥10×, Mega Kazanç ≥25×, Süper Kazanç ≥50×, Efsane Kazanç ≥100×; tavana ulaşan tur Azami Kazanç ile biter. Şablon × genel çarpan ×10 veya üstüyse kurdun ulumasıyla birlikte büyük yazıyla ve kendi sesiyle duyurulur; genel çarpanın her artışı demir dağın çatlamasıyla gösterilir. Ekrana dokunmak sayacı hemen sonuca getirir; ödemeyi değiştirmez.</p>
          </Feature>
          <Feature title={`Şans ×2 · maliyet ${formatDemo(asenaCost(betCents, 'ante'))}`}>
            <p>Açıkken her dönüş bahsin <strong>1,25 katına</strong> mal olur ve temel oyunda Ay Ata çıkma olasılığı artar: bedava dönüş şansı yaklaşık 2 katıdır ({pct(ASENA_RTP.ante.featureRate, 2)} / {pct(ASENA_RTP.standard.featureRate, 2)}). Kazançlar yine taban bahse göre ödenir. Açıkken bonus satın alınamaz.</p>
          </Feature>
          <Feature title={`Bonus satın al · fiyat ${formatDemo(asenaCost(betCents, 'buy'))}`}>
            <p>Bahsin <strong>80 katı</strong> karşılığında tur en az 3 Ay Ata ile başlar; {ASENA_FREE_SPINS_TRIGGER} bedava dönüş garantilidir (Ay Ata ödemesi normal tabloya göre). Satın alma onay penceresiyle yapılır, ayrı bir RTP ile çalışır ({asenaRtp(ASENA_RTP.buy.rtp)}) ve otomatik oyunla kullanılamaz.</p>
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
                  const r = ASENA_RTP[mode];
                  return (
                    <tr key={mode}>
                      <th scope="row">{ASENA_MODE_LABELS[mode]}</th>
                      <td>{mode === 'standard' ? '×1' : mode === 'ante' ? '×1,25' : '×80'}</td>
                      <td><strong>{asenaRtp(r.rtp)}</strong></td>
                      <td>{asenaRtpRange(r.ciLow, r.ciHigh)}</td>
                      <td>{r.featureRate >= 1 ? 'her tur' : `1 / ${int(Math.round(1 / r.featureRate))}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>Her mod için ayrı {int(ASENA_RTP.standard.rounds / 1_000_000)} milyon tur simülasyonu (motor <code>asena-stars-1</code>). RTP ödenen maliyete göre hesaplanır. Kazanç sıklığı (taban dönüş): standart {pct(ASENA_RTP.standard.hitRate)}, Şans ×2 {pct(ASENA_RTP.ante.hitRate)}. Oynaklık (maliyet biriminde standart sapma): standart {ASENA_RTP.standard.stdDev.toFixed(1).replace('.', ',')}, satın alma {ASENA_RTP.buy.stdDev.toFixed(1).replace('.', ',')}.</p>
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
            <div><dt>Basamaklar</dt><dd>{ASENA_BET_LEVELS_CENTS.map(cents => formatAmount(cents, { trimZeros: true })).join(' · ')}</dd></div>
            <div><dt>Şu anki bahis</dt><dd>{formatDemo(betCents)} · Şans ×2 {formatDemo(asenaCost(betCents, 'ante'))} · Satın alma {formatDemo(asenaCost(betCents, 'buy'))}</dd></div>
            <div><dt>Azami kazanç</dt><dd>Bahsin {int(ASENA_MAX_WIN_MULTIPLIER)} katı · bu bahiste {formatDemo(betCents * ASENA_MAX_WIN_MULTIPLIER)}</dd></div>
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
          <p className={styles.note}>Ekran okuyucu her adımı ("6 asena, Kurt Başı ×10, 12,00× kazanç", kurt adımları, harita ve genel çarpan, tur sonucu) duyurur; her hücre sembolü, sütunu ve satırıyla okunur. Semboller renk yanında biçimle de ayrılır (kurt başı, güneş, kartal, at, yıldız, yakut, ok, damga). Hareketi azalt tercihi takımyıldızı tamamlanmış çizer, parçacıkları ve sarsıntıyı kapatır; bütün adımlar yine gösterilir.</p>
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
