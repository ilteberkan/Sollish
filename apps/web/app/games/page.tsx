import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import styles from './page.module.css';
export const metadata: Metadata = { title: 'Oyunlar — Canlı & Solo', description: 'Sollish oyunları. Ortak canlı Ringside maçına katıl veya tek kişilik oyunları dene.' };
const solo = [
  { title: 'Crash', href: '/game/crash', text: 'Çarpan yükselirken çıkış anını sen seç.', type: 'Manuel çıkış', art: 'crash' },
  { title: 'Coinflip', href: '/game/coinflip', text: 'İki yüz, bir seçim, anında sonuç.', type: 'Klasik', art: 'coin' },
  { title: 'Candy Cascade', href: '/game/cascade', text: 'Sekiz eşleşmede patlat, düşen şekerlerle zincir kur.', type: 'Tumble', art: 'candy' },
  { title: 'Tarhun: Fırtına Tahtı', href: '/game/tarhun', text: 'Fırtına tanrısı taşlara yıldırım atar; çarpanlar bedava dönüşte birikir.', type: 'Tumble · çarpan', art: 'storm' },
  { title: 'Ebru: Mürekkep Bahçesi', href: '/game/ebru', text: 'Tarak suyu tarar, mürekkep dalga dalga yeniden dizilir; boya lekeleri çarpanla birlikte kayar.', type: 'Küme · tarak', art: 'ink' },
  { title: 'Cezeri: Zamanın Çarkları', href: '/game/cezeri', text: 'Dört pirinç çark döner; kazanan dilimler kenetlenir, çarklar yeniden döner ve göbek çarpanı her turda +1 atar.', type: 'Çark · zincir', art: 'gears' },
] as const;
export default function Games() { return <div className={styles.page}>
  <Link href="/live/ringside" prefetch={false} className={styles.hero} aria-label="Ringside canlı arenaya gir">
    <Image src="/images/ringside-hero.jpg" alt="" fill unoptimized priority sizes="(max-width: 900px) 100vw, 1240px" className={styles.poster}/>
    <div className={styles.heroCopy}>
      <span className={styles.liveTag}><i/>CANLI · HERKES AYNI MAÇI İZLER</span>
      <h1>Ringside</h1>
      <p>Yumruk ve tekmelerle üç rauntluk dövüş. Maç başlamadan seçimini yap, sonra kuponunu raunt raunt izle. Dövüşçüleri eğitilmiş bir ağ yönetir, köşesinden Jev taktik verir.</p>
      <span className={styles.cta}>Arenaya gir <b>→</b></span>
      <ul className={styles.facts}><li><b>30 sn</b>bahis penceresi</li><li><b>3 × 45 sn</b>raunt</li><li><b>3</b>maç pazarı</li><li><b>%2</b>havuz kesintisi</li></ul>
    </div>
  </Link>

  <section className={styles.section} aria-labelledby="solo-title">
    <div className={styles.sectionTitle}><h2 id="solo-title">Tek kişilik</h2><p>Kendi hızında, anında sonuç.</p></div>
    <div className={styles.soloGrid}>{solo.map(game => <Link href={game.href} prefetch={false} className={styles.soloCard} key={game.href}>
      <span className={styles.soloArt} data-art={game.art} aria-hidden="true">{game.art === 'crash'
        ? <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 20c6-2 11-7 18-16"/><path d="M15 4h6v6"/></svg>
        : game.art === 'storm'
        ? <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"><path d="M5 9.5a4.5 4.5 0 0 1 8.6-1.9A3.6 3.6 0 0 1 19.5 10a3 3 0 0 1-1 5.5H6.8A3.3 3.3 0 0 1 5 9.5Z"/><path d="m12.5 12.5-2.2 4h3l-1.8 4.5"/></svg>
        : game.art === 'gears'
        ? <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="10" r="3"/><path d="M9 3.5v2M9 14.5v2M2.5 10h2M13.5 10h2M4.4 5.4l1.4 1.4M12.2 13.2l1.4 1.4M4.4 14.6l1.4-1.4M12.2 6.8l1.4-1.4"/><circle cx="17" cy="17" r="2.2"/><path d="M17 12.8v1.6M17 19.6v1.6M12.8 17h1.6M19.6 17h1.6"/></svg>
        : game.art === 'ink'
        ? <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"><path d="M12 3c2.8 3.6 4.6 6 4.6 8.4a4.6 4.6 0 0 1-9.2 0C7.4 9 9.2 6.6 12 3Z"/><path d="M10 12.2a2 2 0 0 0 2 1.8"/><path d="M4 20.5h16M6 20.5v-2.5M9.3 20.5v-2.5M12.6 20.5v-2.5M15.9 20.5v-2.5M19 20.5v-2.5"/></svg>
        : game.art === 'candy'
        ? <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><path d="M7.2 9.4 3 7.5l1.2 4.5L3 16.5l4.2-1.9M16.8 9.4 21 7.5l-1.2 4.5 1.2 4.5-4.2-1.9"/></svg>
        : <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>}</span>
      <span className={styles.soloCopy}><b>{game.title}</b><span>{game.text}</span><small>{game.type} · DEMO</small></span>
      <span className={styles.arrow} aria-hidden="true">→</span>
    </Link>)}</div>
  </section>

  <section className={styles.trust} aria-label="Kurallar">
    <div><b>Havuz sistemi</b><p>Bahisler pazar başına ayrı havuzda toplanır, %2 kesintiden sonra kazananlara paylaşılır. Kasa ek kazanç vaat etmez.</p></div>
    <div><b>Doğrulanabilir maç</b><p>Üç raundun seed hash’i bahisten önce yayımlanır. Tarayıcın her rauntu yeniden oynatıp sonucu kontrol eder.</p></div>
    <div><b>Yalnız DEMO</b><p>Krediler değersizdir, çekilemez, token veya airdrop hakkı vermez. Gerçek para doğrulamalar bitene kadar kapalı.</p></div>
  </section>

  <section id="fairness" className={styles.faq} aria-labelledby="faq-title">
    <h2 id="faq-title">Sık sorulanlar</h2>
    <details><summary>Ringside’da bahis nasıl çalışır?</summary><p>Her maç için bahis yalnız R1 başlamadan 30 saniye açıktır. Kazanan, tam sonuç (kazanan ve biçim) ve toplam yere düşme sayısı için ayrı havuzlar vardır; her pazarda maç başına tek bilet alınır. Raunt aralarında yeni bahis alınmaz. Maç durdurmayla ya da üçüncü raundun sonunda biter ve her havuz bir kez sonuçlanır. Tek taraflı ya da kazananı olmayan havuz kesintisiz iade edilir; doğru seçimde bile dönüş yatırdığından az olabilir.</p></details>
    <details><summary>Dövüşçüler nasıl karar veriyor?</summary><p>Her yumruk, tekme, seri, mesafe ve savunma seçimini maç içinde öğrenen bir ağ yapar; MaleCNS sinek bağlantı ağı sabit bir rezervuar olarak kullanılır. Köşe antrenörü Jev her 9 saniyede plan önerir; plan bahis kapandıktan sonra geldiği için oyun yalnız DEMO’dur. Tam beyin ya da bağlantı yapısının üstünlüğü iddiası yoktur.</p></details>
    <details><summary>Demo ile gerçek bahis arasındaki sınır</summary><p>Buradaki DEMO kredilerinin parasal değeri yoktur. Gerçek SOL bahisleri; sözleşme dağıtımı, oracle kurtarma, Crash gizliliği ve ödeme akışları doğrulanana kadar kapalıdır. Bağımsız denetim yapılmış gibi bir iddiada bulunmuyoruz. Bu sürümlerin VRF kanıtı yoktur.</p></details>
  </section>
</div>; }
