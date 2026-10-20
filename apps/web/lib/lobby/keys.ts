/** localStorage keys of the lobby (per browser, never sent anywhere) and the pre-paint head script that reads them.
 * Kept out of the 'use client' store so the server layout can inline the script as a string. */
export const FAVORITES_KEY = 'sollish_favorites';
export const RECENT_KEY = 'sollish_recent';
export const SIDEBAR_KEY = 'sollish_sidebar';

/** Runs in <head> before first paint (no React): restores the sidebar choice and marks a non-empty recent list, so the
 * sidebar width and the "recently played" row are reserved before hydration (no layout shift). */
export const LOBBY_HEAD_SCRIPT = `try{var d=document.documentElement,s=localStorage,b=s.getItem('${SIDEBAR_KEY}');if(b==='open'||b==='rail')d.dataset.sidebar=b;var r=JSON.parse(s.getItem('${RECENT_KEY}')||'[]');if(Array.isArray(r)&&r.length)d.dataset.recent='1'}catch(e){}`;
