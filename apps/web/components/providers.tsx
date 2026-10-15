'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { WalletConnection, type ConnectedWallet, type StandardWallet } from '@/lib/wallet';
import { DEMO_START_CENTS, DemoLedger, type DemoReserveLimits } from '@/lib/demo';

export type DemoGame = 'Crash' | 'Coinflip' | 'Ringside' | 'Cascade' | 'Tarhun' | 'Ebru' | 'Cezeri';
/** Replay data of a Candy Cascade round: the engine re-plays it exactly from these values. */
export type CascadeRoundMeta = { engine: string; seedHex: string; betCents: number; mode: 'standard' | 'ante' | 'buy'; costCents: number };
/** Replay data of a Tarhun: Fırtına Tahtı round (engine storm-throne-1); same shape as the Candy Cascade meta. */
export type StormRoundMeta = { engine: string; seedHex: string; betCents: number; mode: 'standard' | 'ante' | 'buy'; costCents: number };
/** Replay data of an Ebru: Mürekkep Bahçesi round (engine ebru-ink-1); same shape as the Tarhun meta. */
export type EbruRoundMeta = { engine: string; seedHex: string; betCents: number; mode: 'standard' | 'ante' | 'buy'; costCents: number };
/** Replay data of a Cezeri: Zamanın Çarkları round (engine cezeri-gears-1); same shape as the Tarhun meta. */
export type CezeriRoundMeta = { engine: string; seedHex: string; betCents: number; mode: 'standard' | 'ante' | 'buy'; costCents: number };
/** A round the RGS server resolved and settled (lib/rgs-client.ts). The browser only recorded it; it never settled it. */
export type RemoteRoundMeta = { roundId: string; nonce: number; serverSeedHash: string; clientSeed: string };
/** `stake` is what the round cost; `kind: 'reset'` marks a DEMO balance refill line (stake and payout 0). */
export type DemoRecord = { id: string; game: DemoGame; stake: number; payout: number; detail: string; at: number; kind?: 'round' | 'reset'; cascade?: CascadeRoundMeta; storm?: StormRoundMeta; ebru?: EbruRoundMeta; cezeri?: CezeriRoundMeta; remote?: RemoteRoundMeta };
type ProductContext = {
  wallet: ConnectedWallet | null; connectWallet: (wallet: StandardWallet) => Promise<void>; disconnectWallet: () => void;
  walletOpen: boolean; setWalletOpen: (open: boolean) => void;
  demoBalance: number; records: DemoRecord[];
  reserveDemo: (amount: number, limits?: number | DemoReserveLimits) => string | null;
  settleDemo: (record: DemoRecord) => void;
  /** History line for a server-settled round or a server balance reset. Never touches the local ledger; one line per id. */
  recordRemote: (record: DemoRecord) => void;
  /** DEMO only: back to the starting credit. False while a round is reserved or a game reports activity. */
  resetDemoBalance: (game: DemoGame) => boolean;
  activeDemo: boolean; setActiveDemo: (active: boolean) => void;
};
const Context = createContext<ProductContext | null>(null);
export function Providers({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const connection = useRef<WalletConnection | null>(null);
  useEffect(() => {
    let store: Storage | undefined; try { store = window.localStorage; } catch {}
    const manager = new WalletConnection(setWallet, store); connection.current = manager; void manager.start();
    return () => { manager.dispose(); if (connection.current === manager) connection.current = null; };
  }, []);
  const connectWallet = useCallback(async (selected: StandardWallet) => { if (!connection.current) throw new Error('VIEW_CLOSED'); await connection.current.connect(selected); }, []);
  const disconnectWallet = useCallback(() => { void connection.current?.disconnect(); }, []);
  const [walletOpen, setWalletOpen] = useState(false);
  const [demoBalance, setBalance] = useState(DEMO_START_CENTS);
  const [records, setRecords] = useState<DemoRecord[]>([]);
  const [activeDemo, setActiveDemo] = useState(false);
  const ledger = useRef(new DemoLedger());
  const reserveDemo = useCallback((amount: number, limits?: number | DemoReserveLimits) => {
    const id = ledger.current.reserve(amount, undefined, limits);
    if (!id) return null;
    setBalance(ledger.current.balance);
    return id;
  }, []);
  const settleDemo = useCallback((record: DemoRecord) => {
    if (!ledger.current.settle(record)) return;
    setBalance(ledger.current.balance);
    setRecords(current => [record, ...current].slice(0, 30));
  }, []);
  const recordRemote = useCallback((record: DemoRecord) => {
    setRecords(current => (current.some(r => r.id === record.id) ? current : [record, ...current].slice(0, 30)));
  }, []);
  const activeRef = useRef(false);
  useEffect(() => { activeRef.current = activeDemo; }, [activeDemo]);
  const resetDemoBalance = useCallback((game: DemoGame) => {
    if (activeRef.current || !ledger.current.reset()) return false;
    setBalance(ledger.current.balance);
    const at = Date.now();
    setRecords(current => [{ id: `reset:${at}:${current.length}`, game, stake: 0, payout: 0, detail: 'Bakiye yenilendi', at, kind: 'reset' as const }, ...current].slice(0, 30));
    return true;
  }, []);
  return <Context value={{ wallet, connectWallet, disconnectWallet, walletOpen, setWalletOpen, demoBalance, records, reserveDemo, settleDemo, recordRemote, resetDemoBalance, activeDemo, setActiveDemo }}>{children}</Context>;
}
export function useProduct() {
  const context = useContext(Context);
  if (!context) throw new Error('Missing product context');
  return context;
}
