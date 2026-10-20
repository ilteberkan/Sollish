'use client';
import { useT } from '@/lib/i18n/client';

/** The Cezeri paragraphs of the "How does it work?" box (components/game-common.tsx `Rules`). Messages: `cezeri.rules.*`. */
export function CezeriRules() {
  const t = useT('cezeri');
  return <><p>{t('rules.board')}</p><p>{t('rules.features')}</p><p>{t('rules.fixed')}</p></>;
}
