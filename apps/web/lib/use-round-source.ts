'use client';
import { useEffect, useState } from 'react';
import { lastShownRound, localRoundSource, safeSessionStorage, selectRoundSource, type LocalRoundSource, type RemotePlay, type RemoteRoundSource, type RoundOf, type SelectedSource, type SlotGameId } from './rgs-client';
import { configuredApi } from './chat';

/** What a slot game plays against. `pending` only while NEXT_PUBLIC_API_URL is set and the health probe runs; without
 * the variable the answer is `local` from the first render, exactly as before. */
export type RoundSourceView<G extends SlotGameId> =
  | { status: 'pending' }
  | { status: 'local'; source: LocalRoundSource; reason: string }
  | { status: 'remote'; source: RemoteRoundSource; balanceCents: number; recovered: RemotePlay<RoundOf<G>> | null; recoveredBalanceCents: number | null };

const api = configuredApi(process.env.NEXT_PUBLIC_API_URL);
/** One probe per game per page load. Every game reuses the one session token in sessionStorage, so there is one server
 * balance, like the one local ledger. A failed probe keeps this page load local (labelled); a reload probes again. */
const selections = new Map<SlotGameId, Promise<SelectedSource>>();
function select(game: SlotGameId): Promise<SelectedSource> {
  let selection = selections.get(game);
  if (!selection) { selection = selectRoundSource(game, { apiUrl: api ?? undefined, storage: safeSessionStorage() }); selections.set(game, selection); }
  return selection;
}

export function useRoundSource<G extends SlotGameId>(game: G): RoundSourceView<G> {
  const [view, setView] = useState<RoundSourceView<G>>(() => api ? { status: 'pending' } : { status: 'local', source: localRoundSource, reason: 'unconfigured' });
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      const selected = await select(game);
      if (selected.kind === 'local') { if (!cancelled) setView({ status: 'local', source: selected.source, reason: selected.reason }); return; }
      // Reload recovery: the last round of this game, unless this tab already finished presenting it.
      let recovered: RemotePlay<RoundOf<G>> | null = null, balanceCents = selected.balanceCents, recoveredBalanceCents: number | null = null;
      try {
        const last = await selected.source.client.last(game);
        balanceCents = last.balanceCents;
        if (last.last && last.last.receipt.roundId !== lastShownRound(game)) { recovered = last.last; recoveredBalanceCents = last.balanceCents; }
      } catch { /* the balance from the session is still authoritative */ }
      if (!cancelled) setView({ status: 'remote', source: selected.source, balanceCents, recovered, recoveredBalanceCents });
    })();
    return () => { cancelled = true; };
  }, [game]);
  return view;
}
