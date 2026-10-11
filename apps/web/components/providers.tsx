'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { WalletConnection, type ConnectedWallet, type StandardWallet } from '@/lib/wallet';
import { DEMO_START_CENTS, DemoLedger } from '@/lib/demo';

export type DemoRecord = { id: string; game: 'Crash' | 'Coinflip' | 'Ringside' | 'Cascade'; stake: number; payout: number; detail: string; at: number };
type ProductContext = {
  wallet: ConnectedWallet | null; connectWallet: (wallet: StandardWallet) => Promise<void>; disconnectWallet: () => void;
  walletOpen: boolean; setWalletOpen: (open: boolean) => void;
  demoBalance: number; records: DemoRecord[];
  reserveDemo: (amount: number, maxMultiplier?: number) => string | null;
  settleDemo: (record: DemoRecord) => void;
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
  const reserveDemo = useCallback((amount: number, maxMultiplier?: number) => {
    const id = ledger.current.reserve(amount, undefined, maxMultiplier);
    if (!id) return null;
    setBalance(ledger.current.balance);
    return id;
  }, []);
  const settleDemo = useCallback((record: DemoRecord) => {
    if (!ledger.current.settle(record)) return;
    setBalance(ledger.current.balance);
    setRecords(current => [record, ...current].slice(0, 30));
  }, []);
  return <Context value={{ wallet, connectWallet, disconnectWallet, walletOpen, setWalletOpen, demoBalance, records, reserveDemo, settleDemo, activeDemo, setActiveDemo }}>{children}</Context>;
}
export function useProduct() {
  const context = useContext(Context);
  if (!context) throw new Error('Missing product context');
  return context;
}
