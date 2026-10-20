'use client';
/**
 * Per-browser lobby state: favorites and recently played (localStorage), the sidebar preference and the live search
 * query (memory). Each is a tiny external store read with useSyncExternalStore; the server snapshot is empty, so the
 * first render matches SSR. The inline head script in app/layout.tsx (lib/lobby/keys.ts LOBBY_HEAD_SCRIPT) reads the same keys before
 * paint and sets <html data-sidebar data-recent> so the layout is reserved without a shift.
 */
import { useSyncExternalStore } from 'react';
import { isLobbyGameId, pushRecent, toggleFavorite, type LobbyGameId } from './games';

import { FAVORITES_KEY, RECENT_KEY, SIDEBAR_KEY } from './keys';
const EVENT = 'sollish:lobby-store';

function read(key: string): LobbyGameId[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter(isLobbyGameId) : [];
  } catch { return []; }
}
function write(key: string, list: readonly LobbyGameId[]) {
  try { window.localStorage.setItem(key, JSON.stringify(list)); } catch {}
  cache.delete(key);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}
const cache = new Map<string, LobbyGameId[]>();
const EMPTY: LobbyGameId[] = [];
function snapshot(key: string): LobbyGameId[] {
  let hit = cache.get(key);
  if (!hit) { hit = read(key); cache.set(key, hit); }
  return hit;
}
function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === FAVORITES_KEY || event.key === RECENT_KEY) { cache.clear(); callback(); } };
  window.addEventListener('storage', onStorage);
  window.addEventListener(EVENT, callback);
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(EVENT, callback); };
}

export function useFavorites(): LobbyGameId[] {
  return useSyncExternalStore(subscribe, () => snapshot(FAVORITES_KEY), () => EMPTY);
}
export function useRecent(): LobbyGameId[] {
  return useSyncExternalStore(subscribe, () => snapshot(RECENT_KEY), () => EMPTY);
}
export function toggleFavoriteGame(id: LobbyGameId) { write(FAVORITES_KEY, toggleFavorite(snapshot(FAVORITES_KEY), id)); }
export function recordRecentGame(id: LobbyGameId) {
  const next = pushRecent(snapshot(RECENT_KEY), id);
  if (next.join() === snapshot(RECENT_KEY).join()) return;
  write(RECENT_KEY, next);
  document.documentElement.dataset.recent = '1';
}
export function clearRecentGames() { write(RECENT_KEY, []); delete document.documentElement.dataset.recent; }

/* Sidebar: 'open' | 'rail' chosen by the player, or '' (route default). Lives on <html data-sidebar>. */
type SidebarPref = 'open' | 'rail' | '';
const sidebarListeners = new Set<() => void>();
function sidebarSnapshot(): SidebarPref {
  const value = document.documentElement.dataset.sidebar;
  return value === 'open' || value === 'rail' ? value : '';
}
export function useSidebarPref(): SidebarPref {
  return useSyncExternalStore(cb => { sidebarListeners.add(cb); return () => { sidebarListeners.delete(cb); }; }, sidebarSnapshot, () => '');
}
export function setSidebarPref(value: 'open' | 'rail') {
  document.documentElement.dataset.sidebar = value;
  try { window.localStorage.setItem(SIDEBAR_KEY, value); } catch {}
  sidebarListeners.forEach(cb => cb());
}

/* Live search query, shared by the top-bar search and the lobby (memory only; `?q=` seeds it on a fresh load). */
let query = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('q')?.slice(0, 60) ?? '';
const queryListeners = new Set<() => void>();
export function useLobbyQuery(serverQuery = ''): string {
  return useSyncExternalStore(cb => { queryListeners.add(cb); return () => { queryListeners.delete(cb); }; }, () => query, () => serverQuery);
}
export function setLobbyQuery(next: string) {
  const value = next.slice(0, 60);
  if (value === query) return;
  query = value;
  queryListeners.forEach(cb => cb());
}

