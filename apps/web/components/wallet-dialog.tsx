'use client';
import { useEffect, useRef, useState } from 'react';
import { discoverWallets, type StandardWallet } from '@/lib/wallet';
import { shortAddress } from '@/lib/demo';
import { useProduct } from './providers';
import { Icon } from './icons';
import { containDialogFocus } from '@/lib/dialog';

export default function WalletDialog() {
  const { walletOpen, setWalletOpen, wallet, connectWallet, disconnectWallet } = useProduct();
  const dialog = useRef<HTMLDialogElement>(null);
  const [wallets, setWallets] = useState<StandardWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
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
    }).catch(() => { if (alive) { setLoading(false); setError('Cüzdanlar okunamadı. Sayfayı yenileyerek tekrar deneyin.'); } });
    return () => { alive = false; unsubscribe?.(); };
  }, []);
  async function connect(selected: StandardWallet) {
    if (pending) return;
    setPending(selected.name); setError('');
    try {
      await connectWallet(selected);
      setWalletOpen(false);
    } catch { setError('Bağlantı tamamlanmadı. Cüzdan isteğini onaylayıp tekrar deneyebilirsiniz.'); }
    finally { setPending(null); }
  }
  function disconnect() { disconnectWallet(); setWalletOpen(false); }
  return <dialog ref={dialog} className="wallet-dialog" onKeyDown={containDialogFocus} onCancel={() => setWalletOpen(false)} onClick={event => { if (event.target === dialog.current) setWalletOpen(false); }} aria-labelledby="wallet-title">
    <div className="dialog-body">
      <button className="icon-button dialog-close" aria-label="Cüzdan penceresini kapat" onClick={() => setWalletOpen(false)}><Icon name="close"/></button>
      <span className="dialog-symbol"><Icon name="wallet" size={28}/></span>
      <h2 id="wallet-title">{wallet ? 'Cüzdanın' : 'Cüzdanını bağla'}</h2>
      <p className="muted">{wallet ? 'Bağlantı, kendi cüzdanın üzerinden kuruldu.' : 'Varlıkların senin kontrolünde. Bağlanmak bir işlem veya para transferi başlatmaz.'}</p>
      {wallet ? <>
        <div className="connected-account"><span>{wallet.name}</span><strong title={wallet.address}>{shortAddress(wallet.address)}</strong><button className="icon-button" aria-label="Cüzdan adresini kopyala" onClick={async () => { try { await navigator.clipboard.writeText(wallet.address); setCopied(true); } catch { setError('Adres kopyalanamadı.'); } }}><Icon name={copied ? 'check' : 'copy'}/></button></div>
        <p className="small muted">Cüzdan bakiyesi okunmadı. Canlı bahis erişimi bağlantıdan bağımsız olarak doğrulanır.</p>
        <button className="button secondary full-width" onClick={disconnect}><Icon name="exit"/>Bağlantıyı kes</button>
      </> : <div className="wallet-options">
        {loading && <p role="status">Cüzdanlar aranıyor…</p>}
        {!loading && wallets.length === 0 && <div className="no-wallet"><strong>Bu tarayıcıda cüzdan bulunamadı</strong><p>Solana uyumlu Wallet Standard cüzdanını açın veya cüzdan uygulamanızın tarayıcısından bu sayfaya gelin.</p><p className="small">Yerel demoyu cüzdan bağlamadan deneyebilirsiniz.</p></div>}
        {wallets.map((item, index) => <button className="wallet-option" key={`${item.name}-${index}`} onClick={() => connect(item)} disabled={pending !== null}><Icon name="wallet"/><span>{item.name}</span><span className="muted">{pending === item.name ? 'Onay bekleniyor…' : 'Bağlan'}</span><Icon name="chevron" size={16}/></button>)}
      </div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-foot"><Icon name="shield" size={16}/><span>Sollish senden kurtarma kelimelerini istemez.</span></div>
    </div>
  </dialog>;
}
