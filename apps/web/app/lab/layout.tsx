import { I18nMessages } from '@/lib/i18n/messages';
/** Every page under this segment uses the shared slot kit (or game-common), so its messages load here once. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <I18nMessages namespaces={['slotKit']}>{children}</I18nMessages>;
}
