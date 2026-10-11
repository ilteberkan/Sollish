import type { ConnectedWallet } from './wallet';
import { configuredApi } from './chat';

/** Checks the original connection immediately before and after an extension prompt. */
export function chatSigningWallet(wallet: ConnectedWallet, requireContext: () => void) {
  const signMessage = wallet.wallet.features['solana:signMessage'] as {
    signMessage: (...inputs: { account: typeof wallet.account; message: Uint8Array }[]) => Promise<{ signature: Uint8Array }[]>;
  } | undefined;
  if (!signMessage || typeof signMessage.signMessage !== 'function') throw new Error('WALLET_SIGN_MESSAGE_UNAVAILABLE');
  return {
    publicKey: { toBase58: () => wallet.address },
    async signMessage(message: Uint8Array) {
      requireContext();
      const [result] = await signMessage.signMessage({ account: wallet.account, message });
      requireContext();
      if (!result || !(result.signature instanceof Uint8Array) || result.signature.length !== 64) throw new Error('INVALID_SIGNATURE');
      return result.signature;
    },
  };
}

/** Loaded only for an explicit login. Session tokens remain in memory. */
export async function signInToChat(wallet: ConnectedWallet, requireContext: () => void): Promise<{ accessToken: string; expiresAt: number }> {
  requireContext();
  const url = configuredApi(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('CHAT_CONFIG_MISSING');
  const signingWallet = chatSigningWallet(wallet, requireContext);
  const { createClient } = await import('@supabase/supabase-js');
  requireContext();
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await supabase.auth.signInWithWeb3({
    chain: 'solana',
    statement: 'Sign in to Sollish chat. This does not authorize transactions.',
    wallet: signingWallet,
  });
  requireContext();
  if (error || !data.session?.access_token || !data.session.expires_at) throw new Error('CHAT_LOGIN_FAILED');
  return { accessToken: data.session.access_token, expiresAt: data.session.expires_at * 1000 };
}
