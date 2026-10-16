import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import styles from './page.module.css';
import { getTranslator } from '@/lib/i18n/server';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator('lobby');
  return { title: t('meta.title'), description: t('meta.description') };
}
const solo = [
  { id: 'crash', href: '/game/crash', art: 'crash' },
  { id: 'coinflip', href: '/game/coinflip', art: 'coin' },
  { id: 'cascade', href: '/game/cascade', art: 'candy' },
  { id: 'tarhun', href: '/game/tarhun', art: 'storm' },
  { id: 'ebru', href: '/game/ebru', art: 'ink' },
  { id: 'cezeri', href: '/game/cezeri', art: 'gears' },
  { id: 'asena', href: '/game/asena', art: 'stars' },
] as const;
export default async function Games() {
  const [t, common] = await Promise.all([getTranslator('lobby'), getTranslator('common')]);
  return <div className={styles.page}>
  <Link href="/live/ringside" prefetch={false} className={styles.hero} aria-label={t('hero.aria')}>
    <Image src="/images/ringside-hero.jpg" alt="" fill unoptimized priority sizes="(max-width: 900px) 100vw, 1240px" className={styles.poster}/>
    <div className={styles.heroCopy}>
      <span className={styles.liveTag}><i/>{t('hero.tag')}</span>
      <h1>{common('games.ringside')}</h1>
      <p>{t('hero.text')}</p>
      <span className={styles.cta}>{t('hero.cta')} <b>→</b></span>
      <ul className={styles.facts}><li><b>{t('hero.factWindowValue')}</b>{t('hero.factWindow')}</li><li><b>{t('hero.factRoundsValue')}</b>{t('hero.factRounds')}</li><li><b>{t('hero.factMarketsValue')}</b>{t('hero.factMarkets')}</li><li><b>{t('hero.factFeeValue')}</b>{t('hero.factFee')}</li></ul>
    </div>
  </Link>

  <section className={styles.section} aria-labelledby="solo-title">
    <div className={styles.sectionTitle}><h2 id="solo-title">{t('solo.title')}</h2><p>{t('solo.subtitle')}</p></div>
    <div className={styles.soloGrid}>{solo.map(game => <Link href={game.href} prefetch={false} className={styles.soloCard} key={game.href}>
      <span className={styles.soloArt} data-art={game.art} aria-hidden="true">{game.art === 'crash'
        ? <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 20c6-2 11-7 18-16"/><path d="M15 4h6v6"/></svg>
        : game.art === 'storm'
        ? <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"><path d="M5 9.5a4.5 4.5 0 0 1 8.6-1.9A3.6 3.6 0 0 1 19.5 10a3 3 0 0 1-1 5.5H6.8A3.3 3.3 0 0 1 5 9.5Z"/><path d="m12.5 12.5-2.2 4h3l-1.8 4.5"/></svg>
        : game.art === 'stars'
        ? <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17.5 9.5 9l5 3.5L19 5"/><circle cx="5" cy="17.5" r="1.6" fill="currentColor"/><circle cx="9.5" cy="9" r="1.6" fill="currentColor"/><circle cx="14.5" cy="12.5" r="1.6" fill="currentColor"/><circle cx="19" cy="5" r="1.6" fill="currentColor"/><path d="M14.5 12.5 17 19"/><circle cx="17" cy="19" r="1.2"/></svg>
        : game.art === 'gears'
        ? <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="10" r="3"/><path d="M9 3.5v2M9 14.5v2M2.5 10h2M13.5 10h2M4.4 5.4l1.4 1.4M12.2 13.2l1.4 1.4M4.4 14.6l1.4-1.4M12.2 6.8l1.4-1.4"/><circle cx="17" cy="17" r="2.2"/><path d="M17 12.8v1.6M17 19.6v1.6M12.8 17h1.6M19.6 17h1.6"/></svg>
        : game.art === 'ink'
        ? <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"><path d="M12 3c2.8 3.6 4.6 6 4.6 8.4a4.6 4.6 0 0 1-9.2 0C7.4 9 9.2 6.6 12 3Z"/><path d="M10 12.2a2 2 0 0 0 2 1.8"/><path d="M4 20.5h16M6 20.5v-2.5M9.3 20.5v-2.5M12.6 20.5v-2.5M15.9 20.5v-2.5M19 20.5v-2.5"/></svg>
        : game.art === 'candy'
        ? <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><path d="M7.2 9.4 3 7.5l1.2 4.5L3 16.5l4.2-1.9M16.8 9.4 21 7.5l-1.2 4.5 1.2 4.5-4.2-1.9"/></svg>
        : <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>}</span>
      <span className={styles.soloCopy}><b>{common(`games.${game.id}`)}</b><span>{t(`cards.${game.id}.text`)}</span><small>{t(`cards.${game.id}.type`)} · {t('solo.demo')}</small></span>
      <span className={styles.arrow} aria-hidden="true">→</span>
    </Link>)}</div>
  </section>

  <section className={styles.trust} aria-label={t('trust.aria')}>
    <div><b>{t('trust.poolTitle')}</b><p>{t('trust.poolText')}</p></div>
    <div><b>{t('trust.verifyTitle')}</b><p>{t('trust.verifyText')}</p></div>
    <div><b>{t('trust.demoTitle')}</b><p>{t('trust.demoText')}</p></div>
  </section>

  <section id="fairness" className={styles.faq} aria-labelledby="faq-title">
    <h2 id="faq-title">{t('faq.title')}</h2>
    <details><summary>{t('faq.bettingQ')}</summary><p>{t('faq.bettingA')}</p></details>
    <details><summary>{t('faq.fightersQ')}</summary><p>{t('faq.fightersA')}</p></details>
    <details><summary>{t('faq.demoQ')}</summary><p>{t('faq.demoA')}</p></details>
  </section>
</div>;
}
