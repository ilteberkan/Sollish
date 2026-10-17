'use client';
import { useEffect, useState } from 'react';
import { createLocalSource, lastShownRound, safeSessionStorage, selectRoundSource, slotEnginesOf, type LocalRoundSource, type RemotePlay, type RemoteRoundSource, type RoundOf, type SelectedSource, type SlotEngine, type SlotGameId } from './rgs-client';
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
const locals = new Map<SlotGameId, LocalRoundSource>();
/** The local DEMO source of one game, over that game's engine only (lib/slot-engines/<game>.ts). One instance per game. */
export function localSourceFor(engine: SlotEngine): LocalRoundSource {
  let local = locals.get(engine.game);
  if (!local) { local = createLocalSource(slotEnginesOf(engine)); locals.set(engine.game, local); }
  return local;
}
function select(engine: SlotEngine): Promise<SelectedSource> {
  let selection = selections.get(engine.game);
  if (!selection) { selection = selectRoundSource(engine.game, { apiUrl: api ?? undefined, storage: safeSessionStorage(), engines: slotEnginesOf(engine), local: localSourceFor(engine) }); selections.set(engine.game, selection); }
  return selection;
}

export function useRoundSource<G extends SlotGameId>(engine: SlotEngine<G>): RoundSourceView<G> {
  const game = engine.game;
  const [view, setView] = useState<RoundSourceView<G>>(() => api ? { status: 'pending' } : { status: 'local', source: localSourceFor(engine as unknown as SlotEngine), reason: 'unconfigured' });
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      const selected = await select(engine as unknown as SlotEngine);
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
  }, [game, engine]);
  return view;
}
