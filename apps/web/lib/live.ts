import type { CoinflipDeployment, TransactionWallet } from '@sollish/onchain';
import type { ConnectedWallet } from './wallet';
import { publicKey, signature } from '@sollish/protocol';
export type LiveTracking = { player: string; id: bigint; betAddress: string; signature?: string };
export function encodeTracking(tracking: LiveTracking): string {
  return JSON.stringify({ ...tracking, id: tracking.id.toString() });
}
export function decodeTracking(raw: string | null, player: string): LiveTracking | null {
  if (!raw || raw.length > 1024) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.player !== player || !publicKey(value.player) || !publicKey(value.betAddress) || typeof value.id !== 'string' || !/^[1-9]\d{0,19}$/.test(value.id) || BigInt(value.id) > 18_446_744_073_709_551_615n || (value.signature !== undefined && !signature(value.signature))) return null;
    return { player, id: BigInt(value.id), betAddress: value.betAddress, ...(typeof value.signature === 'string' ? { signature: value.signature } : {}) };
  } catch { return null; }
}
export function parseSol(value: string): bigint | null {
  const clean = value.trim().replace(',', '.');
  if (!/^\d{1,9}(?:\.\d{1,9})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  const lamports = BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'));
  return lamports > 0n && lamports <= 18_446_744_073_709_551_615n ? lamports : null;
}
export function solLabel(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${whole.toLocaleString('tr-TR')}${fraction ? `,${fraction}` : ''}`;
}
export function deploymentConfig(enabled: boolean): CoinflipDeployment | null {
  if (!enabled) return null;
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  const houseAuthority = process.env.NEXT_PUBLIC_HOUSE_AUTHORITY;
  const shard = process.env.NEXT_PUBLIC_HOUSE_SHARD_ID;
  if (!rpcUrl || !houseAuthority || !shard || !/^\d{1,5}$/.test(shard) || Number(shard) > 65535) return null;
  try { const url = new URL(rpcUrl); if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null; } catch { return null; }
  return { enabled: true, network: 'devnet', rpcUrl, houseAuthority, shardId: Number(shard) };
}
export function liveDeployment(): CoinflipDeployment | null { return deploymentConfig(process.env.NEXT_PUBLIC_COINFLIP_ENABLED === 'true'); }
export function transactionWallet(wallet: ConnectedWallet, beforeSign?: () => void): TransactionWallet {
  const feature = wallet.wallet.features['solana:signAndSendTransaction'] as {
    signAndSendTransaction: (...inputs: { account: typeof wallet.account; transaction: Uint8Array; chain: 'solana:devnet' }[]) => Promise<{ signature: Uint8Array }[]>;
  } | undefined;
  if (!feature || !wallet.account.chains.includes('solana:devnet')) throw new Error('DEVNET_WALLET_UNSUPPORTED');
  return {
    address: wallet.address,
    async signAndSendTransaction(transaction, chain) {
      beforeSign?.();
      const [result] = await feature.signAndSendTransaction({ account: wallet.account, transaction, chain });
      if (!result) throw new Error('WALLET_NO_RESULT');
      return result.signature;
    },
  };
}
export const liveError: Record<string, string> = {
  WALLET_CHANGED: 'Cüzdan bağlantısı değişti. İşlemi mevcut cüzdanınla yeniden incele.',
  VIEW_CLOSED: 'İşlem ekranı kapandı. Cüzdan çağrısı başlatılmadı.',
  TRACKING_STORAGE_FAILED: 'Tarayıcı işlem takibini saklayamadı. Cüzdan çağrısı yapılmadı. Bu site için oturum depolamasını açıp tekrar deneyebilirsin.',
  HOUSE_PAUSED: 'Oyun kasası şu an duraklatılmış. Bahis kabul edilmiyor.',
  INSUFFICIENT_HOUSE_RESERVE: 'Oyun kasasında bu miktarı karşılayacak rezerv yok.',
  BET_LIMIT_EXCEEDED: 'Miktar, bu oyun masasının sınırını aşıyor.',
  DEVNET_WALLET_UNSUPPORTED: 'Cüzdanının Solana devnet işlem desteği gerekiyor.',
  TRANSACTION_SIMULATION_FAILED: 'İşlem ön kontrolü başarısız. Bahis gönderilmedi.',
  DEPLOYMENT_ACCOUNT_MISSING: 'Oyun sözleşmesi veya gerekli hesaplar henüz hazır değil.',
  GENESIS_MISMATCH: 'Ağ bağlantısı beklenen Solana devnet ağıyla eşleşmiyor.',
  TRANSACTION_FAILED: 'Zincir işlemi başarısız oldu. Bahis kabul edilmedi; ağ ücreti alınmış olabilir.',
};
