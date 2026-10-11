'use client';
import type { ReactNode } from 'react';
import {
  CASCADE2_BET_LEVELS_CENTS, CASCADE2_MAX_WIN_MULTIPLIER, CASCADE2_RTP, CASCADE_FREE_SPINS_RETRIGGER, CASCADE_FREE_SPINS_TRIGGER,
  CASCADE_MAX_FREE_SPINS, type CascadeMode,
} from '@sollish/protocol';
import type { GameInfoPage } from '../slot-kit';
import { formatAmount, formatDemo } from '@/lib/slot-kit/bet';
import { CASCADE_MODE_LABELS, cascadeCost, formatRtp, formatRtpRange } from '@/lib/cascade-controls';
import { PaytableContent } from './paytable';
import { SymbolArt } from './symbols';
import styles from './info.module.css';

const MODES: CascadeMode[] = ['standard', 'ante', 'buy'];
const pct = (ratio: number, digits = 1) => `%${(ratio * 100).toFixed(digits).replace('.', ',')}`;
const int = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

function Feature({ art, title, children }: { art?: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className={styles.feature}>
      {art && <span className={styles.featureArt} aria-hidden="true">{art}</span>}
      <div><h4>{title}</h4>{children}</div>
    </section>
  );
}

/** Multi-page game information (game-standards §3 "Bilgi"). Amounts follow the current bet. */
export function cascadeInfoPages(betCents: number): GameInfoPage[] {
  const minBet = CASCADE2_BET_LEVELS_CENTS[0]!, maxBet = CASCADE2_BET_LEVELS_CENTS[CASCADE2_BET_LEVELS_CENTS.length - 1]!;
  return [
    {
      id: 'how', title: 'Nasıl oynanır',
      content: (
        <div className={styles.page}>
          <h3>Nasıl oynanır</h3>
          <ol className={styles.steps}>
            <li><strong>Bahsini seç.</strong> − ve + düğmeleri bahsi bir basamak değiştirir; bahis tutarına dokununca bütün basamaklar açılır. "Azami bahis" bakiyenin yettiği en yüksek basamağı seçer.</li>
            <li><strong>Çevir.</strong> Büyük düğmeye bas veya Boşluk tuşunu kullan. Bahis tutarı (Şans ×2 açıksa 1,25 katı) bakiyeden bir kez düşer.</li>
            <li><strong>Eşleştir.</strong> 6 sütun × 5 satırlık ızgarada aynı şekerden <strong>her yerde 8 veya daha fazla</strong> varsa kazanırsın; sayı arttıkça ödeme kademesi yükselir.</li>
            <li><strong>Zincir.</strong> Kazanan şekerler patlar, üsttekiler düşer, boşluklar yeni şekerle dolar. Yeni kazanç kalmayana kadar sürer.</li>
            <li><strong>Sonuç.</strong> Turun tamamı dönüş başlamadan önce motorla belirlenir; animasyon yalnızca bu sonucu oynatır. "Atla", hız ayarı, gizli sekme veya sayfadan ayrılma ödemeyi değiştirmez; tur her durumda bir kez, motorun ödemesiyle kapanır.</li>
          </ol>
          <p className={styles.note}>DEMO kredisi değersizdir; SOL, token veya ödül kazandırmaz. Oyun tarayıcıda yerel rastgelelikle çalışır, VRF kanıtı yoktur.</p>
        </div>
      ),
    },
    { id: 'pay', title: 'Ödeme tablosu', content: <><h3 className={styles.pageTitle}>Ödeme tablosu</h3><PaytableContent betCents={betCents} /></> },
    {
      id: 'features', title: 'Özellikler',
      content: (
        <div className={styles.page}>
          <h3>Özellikler</h3>
          <Feature title="Düşen şekerler (tumble)" art={<SymbolArt symbol="strawberry" size="100%" />}>
            <p>Her kazançtan sonra kazanan şekerler patlar, kalanlar aşağı kayar ve boşluklar üstten dolar. Bir dönüşteki bütün düşmeler tek dönüş kazancında toplanır.</p>
          </Feature>
          <Feature title="Yıldız kurabiye (scatter)" art={<SymbolArt symbol="star" size="100%" />}>
            <p>Temel dönüş bitince ızgarada 4 veya daha fazla yıldız varsa ödeme yapar ve {CASCADE_FREE_SPINS_TRIGGER} bedava dönüş açar. Bedava dönüşte 3 veya daha fazla yıldız {CASCADE_FREE_SPINS_RETRIGGER} dönüş daha ekler (ödemesiz). Bir turda en çok {CASCADE_MAX_FREE_SPINS} bedava dönüş oynanır.</p>
          </Feature>
          <Feature title="Çarpan kristalleri" art={<SymbolArt symbol="crystal" multiplier={25} size="100%" />}>
            <p>Yalnız bedava dönüşte düşer ve 2× ile 100× arası değer taşır. Dönüş bitince ızgaradaki kristallerin değerleri toplanır; o dönüşün kazancı sıfırdan büyükse bu toplamla çarpılır. Kazanç yoksa kristal etkisizdir.</p>
          </Feature>
          <Feature title="Bedava dönüş">
            <p>Bedava dönüşler aynı bahisle, aynı tur içinde oynanır; ek ücret alınmaz. Bitince özet kartı toplam kazancı ve oynanan dönüş sayısını gösterir.</p>
          </Feature>
          <Feature title={`Şans ×2 · maliyet ${formatDemo(cascadeCost(betCents, 'ante'))}`}>
            <p>Açıkken her dönüş bahsin <strong>1,25 katına</strong> mal olur ve temel oyunda yıldız çıkma olasılığı artar: bedava dönüş şansı yaklaşık 2 katıdır ({pct(CASCADE2_RTP.ante.featureRate, 2)} / {pct(CASCADE2_RTP.standard.featureRate, 2)}). Kazançlar yine taban bahse göre ödenir. Açıkken bonus satın alınamaz.</p>
          </Feature>
          <Feature title={`Bonus satın al · fiyat ${formatDemo(cascadeCost(betCents, 'buy'))}`}>
            <p>Bahsin <strong>100 katı</strong> karşılığında tur en az 4 yıldızla başlar; {CASCADE_FREE_SPINS_TRIGGER} bedava dönüş garantilidir. Satın alma onay penceresiyle yapılır, ayrı bir RTP ile çalışır ({formatRtp(CASCADE2_RTP.buy.rtp)}) ve otomatik oyunla kullanılamaz.</p>
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
                  const r = CASCADE2_RTP[mode];
                  return (
                    <tr key={mode}>
                      <th scope="row">{CASCADE_MODE_LABELS[mode]}</th>
                      <td>{mode === 'standard' ? '×1' : mode === 'ante' ? '×1,25' : '×100'}</td>
                      <td><strong>{formatRtp(r.rtp)}</strong></td>
                      <td>{formatRtpRange(r.ciLow, r.ciHigh)}</td>
                      <td>{r.featureRate >= 1 ? 'her tur' : `1 / ${int(Math.round(1 / r.featureRate))}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>Her mod için ayrı {int(CASCADE2_RTP.standard.rounds / 1_000_000)} milyon tur simülasyonu (motor <code>candy-cascade-2</code>). RTP, ödenen maliyete göre hesaplanır. Kazanç sıklığı (taban dönüş): standart {pct(CASCADE2_RTP.standard.hitRate)}, Şans ×2 {pct(CASCADE2_RTP.ante.hitRate)}.</p>
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
            <div><dt>Basamaklar</dt><dd>{CASCADE2_BET_LEVELS_CENTS.map(c => formatAmount(c, { trimZeros: true })).join(' · ')}</dd></div>
            <div><dt>Şu anki bahis</dt><dd>{formatDemo(betCents)} · Şans ×2 {formatDemo(cascadeCost(betCents, 'ante'))} · Satın alma {formatDemo(cascadeCost(betCents, 'buy'))}</dd></div>
            <div><dt>Azami kazanç</dt><dd>Bahsin {int(CASCADE2_MAX_WIN_MULTIPLIER)} katı · bu bahiste {formatDemo(betCents * CASCADE2_MAX_WIN_MULTIPLIER)}</dd></div>
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
            <div><dt><kbd>Boşluk</kbd></dt><dd>Dönüşü başlatır; dönüş sırasında kartı ve kazanç sayacını geçer (Ayarlar → "Boşluk tuşuyla döndür").</dd></div>
            <div><dt><kbd>Enter</kbd></dt><dd>Odaktaki düğmeye basar.</dd></div>
            <div><dt><kbd>Esc</kbd></dt><dd>Açık pencereyi kapatır (oturum hatırlatması hariç).</dd></div>
            <div><dt><kbd>Tab</kbd></dt><dd>Kontroller arasında gezinir; odak her zaman görünür.</dd></div>
            <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Bu bilgi penceresinde sayfa değiştirir; ayar seçimlerinde seçeneği değiştirir.</dd></div>
            <div><dt><kbd>PageUp</kbd> <kbd>PageDown</kbd></dt><dd>Bilgi sayfaları arasında gezinir.</dd></div>
          </dl>
          <p className={styles.note}>Ekran okuyucu her adımı ("8 çilek, 2,02× kazanç", tur sonucu) duyurur; ızgara 6×5 tablo olarak okunur. Hareketi azalt tercihi parçacık ve sarsıntıyı kapatır.</p>
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
