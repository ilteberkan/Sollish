import { Suspense } from 'react';
import { I18nMessages } from '@/lib/i18n/messages';
import { getTranslator } from '@/lib/i18n/server';
import { Lobby } from './lobby';
import s from './lobby.module.css';

/** The casino lobby (served at / and /games). The interactive part is one client component; the rules and FAQ below
 * it are server-rendered text. */
export async function LobbyPage() {
  const t = await getTranslator('lobby');
  return <div className={s.page}>
    <I18nMessages namespaces={['lobby']}>
      <Suspense fallback={null}><Lobby /></Suspense>
    </I18nMessages>
    <section className={s.trust} aria-label={t('trust.aria')}>
      <div><b>{t('trust.poolTitle')}</b><p>{t('trust.poolText')}</p></div>
      <div><b>{t('trust.verifyTitle')}</b><p>{t('trust.verifyText')}</p></div>
      <div><b>{t('trust.demoTitle')}</b><p>{t('trust.demoText')}</p></div>
    </section>
    <section id="fairness" className={s.faq} aria-labelledby="faq-title">
      <h2 id="faq-title">{t('faq.title')}</h2>
      <details><summary>{t('faq.bettingQ')}</summary><p>{t('faq.bettingA')}</p></details>
      <details><summary>{t('faq.fightersQ')}</summary><p>{t('faq.fightersA')}</p></details>
      <details><summary>{t('faq.demoQ')}</summary><p>{t('faq.demoA')}</p></details>
    </section>
  </div>;
}
