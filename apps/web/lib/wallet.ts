export interface ConnectedWallet {
  name: string;
  address: string;
  publicKey: Uint8Array;
  account: WalletAccount;
  wallet: StandardWallet;
}
export interface WalletAccount {
  address: string;
  publicKey: Uint8Array;
  chains: readonly string[];
  features: readonly string[];
}
export interface StandardWallet {
  name: string;
  icon: string;
  chains: readonly string[];
  accounts: readonly WalletAccount[];
  features: Record<string, unknown>;
}
export type ConnectFeature = { connect: (input?: { silent?: boolean }) => Promise<{ accounts: readonly WalletAccount[] }> };
export type DisconnectFeature = { disconnect: () => Promise<void> };
export type EventsFeature = { on: (event: 'change', listener: (change: { accounts?: readonly WalletAccount[]; chains?: readonly string[]; features?: Record<string, unknown> }) => void) => () => void };
export type WalletRegistry = { readonly wallets: StandardWallet[]; subscribe: (callback: () => void) => () => void };
/** Only a wallet name is retained. No address, signature, transaction or authentication session. */
export const WALLET_PREFERENCE_KEY = 'sollish.wallet.preference.v1';
type PreferenceStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function walletName(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value); }
function addressOf(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n, result = '', zeros = 0;
  for (const byte of bytes) n = n * 256n + BigInt(byte);
  while (n > 0n) { result = alphabet[Number(n % 58n)] + result; n /= 58n; }
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return '1'.repeat(zeros) + result;
}
export function connectedWallet(wallet: StandardWallet, accounts: readonly WalletAccount[], preferred?: string): ConnectedWallet | null {
  if (!walletName(wallet.name) || !Array.isArray(accounts)) return null;
  const compatible = accounts.filter(account => account && account.publicKey instanceof Uint8Array && account.publicKey.length === 32
    && account.address === addressOf(account.publicKey) && Array.isArray(account.chains) && account.chains.some((chain: unknown) => typeof chain === 'string' && chain.startsWith('solana:')) && Array.isArray(account.features));
  const account = compatible.find(account => account.address === preferred) ?? compatible[0];
  return account ? { name: wallet.name, address: account.address, publicKey: new Uint8Array(account.publicKey), account, wallet } : null;
}

/** Wallet Standard silent connect asks only for previously authorized accounts. It is not SIWS.
 * https://github.com/wallet-standard/wallet-standard/blob/master/packages/core/features/src/connect.ts
 * Registry registration can happen after hydration. Every asynchronous operation is generation
 * bound so disconnect, unregister or a newer selection cannot be undone by an old response.
 */
export class WalletConnection {
  private live = true;
  private generation = 0;
  private current: ConnectedWallet | null = null;
  private candidate: StandardWallet | null = null;
  private preference: string | null = null;
  private registry: WalletRegistry | null = null;
  private offRegistry?: () => void;
  private offEvents?: () => void;
  private readonly attempted = new WeakSet<StandardWallet>();
  constructor(private readonly publish: (wallet: ConnectedWallet | null) => void, private readonly store?: PreferenceStore, private readonly discover: () => Promise<WalletRegistry> = discoverWallets) {
    try { const saved = store?.getItem(WALLET_PREFERENCE_KEY); if (walletName(saved)) this.preference = saved; } catch {}
  }
  private remember(name: string | null) { this.preference = name; try { if (name) this.store?.setItem(WALLET_PREFERENCE_KEY, name); else this.store?.removeItem(WALLET_PREFERENCE_KEY); } catch {} }
  private reset(forget: boolean) {
    this.generation++; this.offEvents?.(); this.offEvents = undefined; this.candidate = null; this.current = null;
    if (forget) this.remember(null);
    if (this.live) this.publish(null);
  }
  async start(): Promise<void> {
    try { const registry = await this.discover(); if (!this.live) return; this.registry = registry; this.offRegistry = registry.subscribe(() => this.refresh()); this.refresh(); } catch { /* Manual discovery can still be retried by opening the wallet dialog. */ }
  }
  private refresh() {
    if (!this.live || !this.registry) return;
    if (this.candidate && !this.registry.wallets.includes(this.candidate)) { this.reset(false); return; }
    if (this.current || this.candidate || !this.preference) return;
    const matches = this.registry.wallets.filter(wallet => wallet.name === this.preference);
    // Wallet names are discovery labels, not authenticated identities. Ambiguity requires a click.
    if (matches.length !== 1 || this.attempted.has(matches[0])) return;
    this.attempted.add(matches[0]); void this.connect(matches[0], true).catch(() => {});
  }
  async connect(wallet: StandardWallet, silent = false): Promise<void> {
    if (!this.live) throw new Error('VIEW_CLOSED');
    if (silent && wallet.name !== this.preference) throw new Error('WALLET_NOT_SELECTED');
    const feature = wallet.features['standard:connect'] as ConnectFeature | undefined;
    if (!feature || typeof feature.connect !== 'function') throw new Error('WALLET_UNSUPPORTED');
    this.reset(false); const generation = this.generation; this.candidate = wallet;
    try {
      const result = await feature.connect(silent ? { silent: true } : undefined);
      if (!this.live || generation !== this.generation) throw new Error('WALLET_CHANGED');
      const connection = connectedWallet(wallet, result.accounts);
      if (!connection) throw new Error('WALLET_NO_ACCOUNT');
      this.current = connection; this.remember(wallet.name); this.publish(connection);
      const events = wallet.features['standard:events'] as EventsFeature | undefined;
      this.offEvents = events?.on('change', change => {
        if (!this.live || generation !== this.generation) return;
        if (!change.accounts && !change.chains && !change.features) return;
        const next = connectedWallet(wallet, change.accounts ?? wallet.accounts, this.current?.address);
        if (!next) { this.reset(true); return; }
        this.current = next; this.publish(next);
      });
    } catch (error) { if (this.live && generation === this.generation) { this.candidate = null; this.current = null; this.publish(null); } throw error; }
  }
  async disconnect(): Promise<void> {
    const wallet = this.current?.wallet ?? this.candidate; this.reset(true);
    // Local disconnection is immediate even if an extension rejects or never resolves its request.
    try { await (wallet?.features['standard:disconnect'] as DisconnectFeature | undefined)?.disconnect(); } catch {}
  }
  dispose() { this.live = false; this.generation++; this.offRegistry?.(); this.offEvents?.(); }
}

/** A review belongs to one connection instance, including a reconnect to the same address. */
export function assertWalletContext(expected: ConnectedWallet | null, current: ConnectedWallet | null, alive: boolean): void {
  if (!alive) throw new Error('VIEW_CLOSED');
  if (!expected || expected !== current || expected.address !== current.address) throw new Error('WALLET_CHANGED');
}

export async function discoverWallets(): Promise<WalletRegistry> {
  const { getWallets } = await import('@wallet-standard/app');
  const registry = getWallets();
  const supported = () => registry.get().filter(wallet =>
    wallet.chains.some(chain => chain.startsWith('solana:')) && wallet.features['standard:connect'],
  ) as unknown as StandardWallet[];
  return {
    get wallets() { return supported(); },
    subscribe(callback) {
      const offRegister = registry.on('register', callback);
      const offUnregister = registry.on('unregister', callback);
      return () => { offRegister(); offUnregister(); };
    },
  };
}
