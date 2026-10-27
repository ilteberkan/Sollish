# Sollish tasarım sistemi (27 Ekim 2026, sahip kararı)

Sahip, bet365 / 888casino / "Lucky" ekranlarını referans verdi ve "birebir uygulanmalı" dedi. Uygulanan: **yerleşim, bilgi
mimarisi, bileşen kalıpları, yoğunluk ve etkileşimler** birebir. Uygulanmayan (hukuki/marka nedeni): o sitelerin
logoları, adları, oyun görselleri, krupiye fotoğrafları, promosyon metinleri. Bütün içerik Sollish'in kendi oyunları ve
özgün sanatıdır (AGENTS.md, `game-standards.md`).

## Alt markalar
| Yüzey | Renk | Yazı | Not |
|---|---|---|---|
| Tüketici (web, bu dal) | siyah + neon lime `oklch(84.1% .238 128.85)` | IBM Plex Sans; vurgu Playfair Display italic | uygulanıyor |
| Geliştirici portalı | lavanta `#a78bfa` | Inter 72px display | WebGL 3D dalga arka planı; henüz portal yok |
| Android | Inter + Material 3 | Solar ikon seti | henüz uygulama yok |

Kütüphane yönü: Radix primitives (shadcn kalıpları, Tailwind olmadan CSS modülleriyle), lucide (+ Iconify), Framer Motion
(`motion`), Three.js (yalnız geliştirici portalı), TipTap ve LiveKit (ilgili özellik gelince).

## Tüketici token sözleşmesi (`apps/web/app/globals.css` `:root`)
Bütün yeni kabuk/lobi/oyun-kabuğu kodu yalnız bu adları kullanır; ham renk yazmaz.

```
--sx-bg:        #000000          sayfa
--sx-bg-1:      #0b0b0c          kenar menü, üst çubuk
--sx-surface:   #141416          kart, panel
--sx-surface-2: #1c1c1f          kart üstü, input
--sx-line:      #26262a          ince çizgi
--sx-text:      #f5f5f4
--sx-muted:     #a1a1aa
--sx-lime:      oklch(84.1% .238 128.85)   ana vurgu (CTA, aktif menü, rozet)
--sx-lime-ink:  #0a0a0a          lime üstündeki yazı
--sx-lime-soft: oklch(84.1% .238 128.85 / .14)
--sx-yellow:    #ffd400          ikincil CTA (Kayıt ol tarzı)
--sx-danger:    #ef4444          canlı/son sonuç kırmızısı
--sx-radius-sm: 6px; --sx-radius: 10px; --sx-radius-lg: 14px; --sx-radius-pill: 999px
--font-sans:    'IBM Plex Sans' (400/500/600/700, latin+latin-ext; zh/ko sistem yedeği)
--font-accent:  'Playfair Display' italic 600/700 (başlıkta tek kelime vurgu: <em class="accent">)
```
Mevcut `--bg --surface --accent --text --muted --line` bu değerlere eşlenir (focus halkası lime olur). Oyun ekranlarının
kendi sanat paletleri değişmez; yalnız kabuk, lobi ve ortak slot-kit yüzeyleri bu sistemi kullanır.

## Bileşen kalıpları (referans → Sollish)
- **Kabuk (888):** sol menü 240px, üstte logo bloğu; altında Bildirimler / Ücretsiz oyun kare düğmeleri; hap biçimli
  menü öğeleri (renkli yuvarlak ikon + etiket, aktif öğe lime çerçeve + lime yazı); altta saat. Üst çubuk: arama,
  ayarlar, yardım, sağda sarı "Kayıt ol" + lime çerçeveli "Giriş yap" (bizde cüzdan bağla / DEMO bakiye). Tablet:
  ikon şeridi; telefon: alt sekme çubuğu.
- **Lobi (888 + bet365):** promosyon kahramanı (solda büyük başlık + lime CTA, sağda sanat, oklar); kategori
  kareleri (Canlı, Slotlar, Yeni, Jackpot→Kanıtlanabilir adil, Özel, Anında); "Sadece Sollish'te" satırı: kare
  kartlar, sol üstte lime "ÖZEL" rozeti, sağ altta lime yuvarlak "i" bilgi düğmesi, yatay kaydırma + ok; "Öne çıkanlar"
  yuvarlak kartlar; satır başlığında "Tümünü gör" hap düğmesi.
- **Canlı ızgara (888 Live Casino):** üstte sekmeler (Öne çıkan, Özel, Yeni, …); 16:9 kartlar, sol üstte bahis aralığı
  rozeti, sol altta sunucu/oyuncu sayısı, sağ altta son sonuç rozetleri (kırmızı/beyaz), altta kart adı şeridi.
- **Originals oyun sayfası (Lucky):** solda bahis paneli (Manuel/Otomatik sekmesi, bahis tutarı + ½ + 2×, seçim
  düğmeleri, toplam kâr), sağda oyun alanı; altında bilgi şeridi (ayarlar, tiyatro, tam ekran, favori; ortada logo;
  sağda "Kanıtlanabilir adil"), oyun kartı satırı (Original etiketi, RTP hapı, "Şansımı dene" lime düğme); en altta
  renkli Originals kart satırı.
