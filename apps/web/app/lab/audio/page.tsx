import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { AudioLabSwitch } from './game-switch';

export const metadata: Metadata = { title: 'Ses laboratuvarı', robots: { index: false, follow: false } };

/** Development-only listening page for the slot audio engine; 404 in production builds. */
export default function AudioLabPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 16px 64px', display: 'grid', gap: 16 }}>
      <h1 style={{ fontSize: 26, margin: 0 }}>Slot ses laboratuvarı (yalnız geliştirme)</h1>
      <p style={{ color: 'var(--muted)', margin: 0 }}>
        Bütün müzik ve efektler özgündür ve tarayıcıda koddan üretilir (kayıt dosyası yok). Önce “Sesi aç” düğmesine bas;
        temel tema ve temel efektler hazır olunca çalar, özellik teması ve stinger’lar arkadan gelir. Oyunu aşağıdan seç.
      </p>
      <AudioLabSwitch />
    </main>
  );
}
