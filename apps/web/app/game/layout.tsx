import { I18nMessages } from '@/lib/i18n/messages';
import { SimilarGames } from '@/components/game-info-strip';
/** Every page under this segment uses the shared slot kit (or game-common), so its messages load here once. `lobby`
 * carries the info strip under each game and the "Similar games" row (registry-driven, lib/lobby/games.ts). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <I18nMessages namespaces={['slotKit', 'lobby']}>{children}<SimilarGames /></I18nMessages>;
}
