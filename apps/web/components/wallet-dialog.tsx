'use client';
import { useEffect, useRef, useState } from 'react';
import { discoverWallets, type StandardWallet } from '@/lib/wallet';
import { shortAddress } from '@/lib/demo';
import { useProduct } from './providers';
import { Icon } from './icons';
import { containDialogFocus } from '@/lib/dialog';
import { useT } from '@/lib/i18n/client';

export default function WalletDialog() {
  const { walletOpen, setWalletOpen, wallet, connectWallet, disconnectWallet } = useProduct();
  const t = useT('common');
  const dialog = useRef<HTMLDialogElement>(null);
  const [wallets, setWallets] = useState<StandardWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<'' | 'readFailed' | 'connectFailed' | 'copyFailed'>('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    if (walletOpen) { element?.showModal(); setError(''); } else element?.close();
  }, [walletOpen]);
  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    discoverWallets().then(registry => {
      if (!alive) return;
      setWallets(registry.wallets);
      setLoading(false);
      unsubscribe = registry.subscribe(() => setWallets(registry.wallets));
    }).catch(() => { if (alive) { setLoading(false); setError('readFailed'); } });
    return () => { alive = false; unsubscribe?.(); };
  }, []);
  async function connect(selected: StandardWallet) {
    if (pending) return;
    setPending(selected.name); setError('');
    try {
      await connectWallet(selected);
      setWalletOpen(false);
    } catch { setError('connectFailed'); }
    finally { setPending(null); }
  }
  function disconnect() { disconnectWallet(); setWalletOpen(false); }
  return <dialog ref={dialog} className="wallet-dialog" onKeyDown={containDialogFocus} onCancel={() => setWalletOpen(false)} onClick={event => { if (event.target === dialog.current) setWalletOpen(false); }} aria-labelledby="wallet-title">
    <div className="dialog-body">
      <button className="icon-button dialog-close" aria-label={t('wallet.close')} onClick={() => setWalletOpen(false)}><Icon name="close"/></button>
      <span className="dialog-symbol"><Icon name="wallet" size={28}/></span>
      <h2 id="wallet-title">{wallet ? t('wallet.titleConnected') : t('wallet.titleConnect')}</h2>
      <p className="muted">{wallet ? t('wallet.leadConnected') : t('wallet.leadConnect')}</p>
      {wallet ? <>
        <div className="connected-account"><span>{wallet.name}</span><strong title={wallet.address}>{shortAddress(wallet.address)}</strong><button className="icon-button" aria-label={t('wallet.copy')} onClick={async () => { try { await navigator.clipboard.writeText(wallet.address); setCopied(true); } catch { setError('copyFailed'); } }}><Icon name={copied ? 'check' : 'copy'}/></button></div>
        <p className="small muted">{t('wallet.balanceNote')}</p>
        <button className="button secondary full-width" onClick={disconnect}><Icon name="exit"/>{t('wallet.disconnect')}</button>
      </> : <div className="wallet-options">
        {loading && <p role="status">{t('wallet.searching')}</p>}
        {!loading && wallets.length === 0 && <div className="no-wallet"><strong>{t('wallet.noneTitle')}</strong><p>{t('wallet.noneText')}</p><p className="small">{t('wallet.noneDemo')}</p></div>}
        {wallets.map((item, index) => <button className="wallet-option" key={`${item.name}-${index}`} onClick={() => connect(item)} disabled={pending !== null}><Icon name="wallet"/><span>{item.name}</span><span className="muted">{pending === item.name ? t('wallet.awaiting') : t('wallet.connect')}</span><Icon name="chevron" size={16}/></button>)}
      </div>}
      {error && <p className="form-error" role="alert">{t(`wallet.${error}`)}</p>}
      <div className="dialog-foot"><Icon name="shield" size={16}/><span>{t('wallet.seedWarning')}</span></div>
    </div>
  </dialog>;
}
