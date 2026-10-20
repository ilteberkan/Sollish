'use client';
import { useT } from '@/lib/i18n/client';

/** The Asena paragraphs of the "How does it work?" box (components/game-common.tsx `Rules`). Messages: `asena.rules.*`. */
export function AsenaRules() {
  const t = useT('asena');
  return <><p>{t('rules.board')}</p><p>{t('rules.features')}</p><p>{t('rules.fixed')}</p></>;
}
