'use client';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './icons';
import { useT } from '@/lib/i18n/client';
import { LOBBY_GAMES, matchesQuery, searchText, type LobbyGame } from '@/lib/lobby/games';
import { setLobbyQuery, useLobbyQuery } from '@/lib/lobby/store';

/**
 * Top-bar game search (WAI-ARIA combobox). On the lobby it filters the lobby in place (the lobby reads the same
 * query); elsewhere it lists matching games below the field: arrows move, Enter opens, Escape clears.
 */
export function ShellSearch({ onLobby, lobbyPath, disabled, inputRef, onClose }: { onLobby: boolean; lobbyPath: string; disabled: boolean; inputRef: RefObject<HTMLInputElement | null>; onClose?: () => void }) {
  const t = useT('common');
  const router = useRouter();
  const query = useLobbyQuery();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const kindLabel = (game: LobbyGame) => t(`shell.kind.${game.kind}`);
  const matches = useMemo(() => query.trim()
    ? LOBBY_GAMES.filter(g => matchesQuery(searchText(g, t(`games.${g.id}`), [kindLabel(g)]), query))
    : [], [query, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = focused && !onLobby && query.trim().length > 0;
  useEffect(() => { setActive(-1); }, [query]);
  const close = useRef<number>(0);
  const go = (href: string) => { setFocused(false); onClose?.(); router.push(href); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && open) { event.preventDefault(); setActive(i => Math.min(matches.length - 1, i + 1)); }
    else if (event.key === 'ArrowUp' && open) { event.preventDefault(); setActive(i => Math.max(-1, i - 1)); }
    else if (event.key === 'Escape') { if (query) { event.preventDefault(); setLobbyQuery(''); } else onClose?.(); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      if (open && active >= 0 && matches[active]) go(matches[active].href);
      else if (!onLobby && query.trim()) go(`${lobbyPath}?q=${encodeURIComponent(query.trim())}`);
      else if (onLobby) document.getElementById('lobby-results')?.scrollIntoView({ block: 'start' });
    }
  };
  return (
    <div className="shell-search" role="search">
      <Icon name="search" size={18} className="shell-search-icon" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label={t('shell.search.label')}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={t('shell.search.placeholder')}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={60}
        value={query}
        disabled={disabled}
        onChange={event => setLobbyQuery(event.target.value)}
        onFocus={() => { window.clearTimeout(close.current); setFocused(true); }}
        onBlur={() => { close.current = window.setTimeout(() => setFocused(false), 120); }}
        onKeyDown={onKeyDown}
      />
      {query && <button type="button" className="shell-search-clear" aria-label={t('shell.search.clear')} onClick={() => { setLobbyQuery(''); inputRef.current?.focus(); }}><Icon name="close" size={16} /></button>}
      <div className="shell-search-panel" hidden={!open}>
        <ul id={listId} role="listbox" aria-label={t('shell.search.results', { count: matches.length })}>
          {matches.map((game, index) => (
            <li key={game.id} id={`${listId}-${index}`} role="option" aria-selected={index === active} className="shell-search-option"
              onPointerDown={event => event.preventDefault()} onClick={() => go(game.href)} onPointerEnter={() => setActive(index)}>
              <span className="shell-search-thumb" style={{ background: `linear-gradient(135deg, ${game.tone[0]}, ${game.tone[1]})` }}><Icon name={game.icon} size={18} /></span>
              <span><b>{t(`games.${game.id}`)}</b><small>{kindLabel(game)} · Sollish</small></span>
            </li>
          ))}
        </ul>
        <p className="shell-search-status" aria-live="polite">{t('shell.search.results', { count: matches.length })}</p>
        {query.trim() && <button type="button" className="shell-search-all" onPointerDown={event => event.preventDefault()} onClick={() => go(`${lobbyPath}?q=${encodeURIComponent(query.trim())}`)}>{t('shell.search.seeAll')}<Icon name="arrow" size={16} /></button>}
      </div>
    </div>
  );
}
