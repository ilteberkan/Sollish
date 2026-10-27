# Lobi tasarımı — referans eşlemesi (27 Ekim 2026, parça B)

Kapsam: lobi içeriği (`/` ve `/games`). Kabuk (sol menü, üst çubuk, sohbet paneli) parça A'nındır; ekran görüntülerinde
görünür ama burada değerlendirilmez. Sözleşme: `docs/product/design-system.md`.

Ekran görüntüleri (Next dev :3000, tr, tam sayfa, `scratchpad/shots.cjs` ile Playwright Chromium):
`before-*.png` değişiklikten önce, `after-*.png` sonra; 1440×900, 834×1112, 390×844. 834 ve 390'da kabuğun sohbet
paneli açık olduğu için ana sütun dar; lobi kapsayıcı sorgularıyla telefon yerleşimine geçer.

Referans görseller (sahibin dört ekranı) depoya kopyalanmadı: üçüncü taraf logoları, oyun görselleri ve gerçek kişi
fotoğrafları içeriyor. Yalnız açıklamaları:
1. bet365 "ONLY AT BET365" + "YOUR LIVE CASINO" satırları (kare kartlar, EXCLUSIVE rozeti, yeşil "i").
2. 888casino lobisi (promosyon kahramanı, kategori kareleri, yuvarlak "Featured games").
3. 888casino Live Casino ızgarası (sekmeler, 16:9 kartlar, bahis aralığı, krupiye/oyuncu sayısı, sonuç rozetleri).
4. "Lucky" Originals sayfası (renkli başlık bantlı kartlar, Original/UPDATED kurdeleleri).

## Kalıp kalıp eşleme
| Referans öğesi | Sollish öğesi | Dosya |
|---|---|---|
| 888 promosyon kahramanı: solda büyük başlık, kısa satır, sarı CTA, sağda sanat, kenar okları, noktalar | Vitrin: oyun adının marka kelimesi Playfair italik lime (`em.accent`), slogan, RTP/en çok/oynaklık hapları, lime hap "Demoyu oyna", sağda kendi wide posterimiz, sol/sağ yuvarlak oklar, alt ortada noktalar + duraklat; 5 öne çıkan slot döner (APG carousel kuralları korunur) | `components/lobby/lobby-hero.tsx` |
| 888 kategori kareleri (Live Casino, Slots, New Games, Jackpots, 888 Exclusive, Casino Games) | Canlı, Slotlar, Yeni oyunlar, Kanıtlanabilir adil (Jackpot yerine), Sollish Özel, Anında oyunlar: yuvarlak köşeli kare, kendi posterimiz + lime çerçeveli işaret, altında büyük harf başlık; `?c=` gerçek bağlantı | `components/lobby/lobby-categories.tsx` |
| bet365 "ONLY AT BET365": kare kart, tam poster, sol üstte yeşil EXCLUSIVE, sağ altta yeşil yuvarlak "i", sağda ok, başlık kalın büyük harf, "View All" hap | "SADECE SOLLISH'TE": 7 kare kart (registry `exclusive`), lime "ÖZEL", lime "i" → yerel popover (RTP, en çok, oynaklık `lobbyStats`/`SLOT_GAME_META`'dan; oyna + favori), kenar oku, "Tümünü gör" hap | `components/lobby/lobby-cards.tsx` (`ExclusiveTile`, `InfoPopover`), `lobby-row.tsx` |
| 888 "FEATURED GAMES" yuvarlak kartlar, altta ad + tutar | "ÖNE ÇIKAN OYUNLAR": dairesel poster, ad, altında lime "En çok ×N" hapı (jackpot tutarı uydurulmadı; azami kazanç) | `lobby-cards.tsx` (`RoundTile`) |
| 888 Live Casino: üstte ikonlu sekmeler, 16:9 kart, sol üst bahis aralığı, sol alt krupiye + oyuncu sayısı, sağ alt kırmızı/beyaz son sonuçlar, altta ad şeridi | "CANLI CASİNO": Radix sekmeler (Öne çıkan, Sollish Özel, Yeni, Havuz bahsi), 16:9 Ringside kartı, "1–500 DEMO" (`LIVE_MIN/MAX_BET_CENTS` = Ringside bilet doğrulayıcısı 100–50 000), sol alt "Jev" (köşe antrenörü) + "Ortak maç", sağ alt sonuç rozeti alanı (kırmızı KOR / beyaz AYAZ), altta ad + CANLI | `components/lobby/lobby-live.tsx`, `lib/lobby/live.ts` |
| Lucky Originals satırı: renkli kart, alt büyük başlık bandı, sağ üst FLIP!/UPDATED kurdelesi | "ANINDA OYUNLAR": Crash, Coinflip, Damla; oyun tonunda başlık bandı, "ORİJİNAL" (lime) / "YENİ" (kırmızı) kurdele | `lobby-cards.tsx` (`BandTile`) |
| 888 Live Casino sekme çubuğu (kategori sayfası) | Kategori ızgarasının filtre hapları (Tümü … Favoriler), aktif lime | `components/lobby/lobby.tsx` |
| Satır başlığı + View All | Bütün satırlarda büyük harf kalın başlık, "Tümünü gör" hap, yuvarlak ileri/geri | `lobby-row.tsx` |

Renkler yalnız `--sx-*` tokenları (saydam katmanlar `color-mix(var(--sx-bg) …)`), yazı `--font-sans`/`--font-accent`.
Tek istisna: oyun sayfası bilgi şeridi bloğu (`.infoStrip…`, parça C'nin sayfalarında) dokunulmadan bırakıldı.

## Bilinçli farklar / sınırlar
- Canlı izleyici sayısı ve son sonuçlar: lobinin genel HTTP akışı yok (veri yalnız arena soketinde). Sayı uydurulmadı;
  kart "Ortak maç" ve "Sonuçlar arenada" gösterir. Akış eklenince `LiveTable.results` dolar, rozetler kırmızı/beyaz çizilir.
- Canlı ızgarada bugün tek masa var (Ringside); "Yeni" sekmesi boş durum metni gösterir.
- Kategori karelerinde sayılar kaldırıldı (888'de yok); sayı ızgara başlığında.
- Ana görünümde filtre hapları yok (888'de yok); favoriler: popover'daki kalp, favori satırı ("Favorilerin") ve ızgara hapı.
- Görsel kabul sahibindir; bu notlar ve test sayısı kabul yerine geçmez.

## Kanıt
- `bash scripts/use-node.sh pnpm --filter @sollish/web typecheck` → geçti.
- `bash scripts/use-node.sh pnpm --filter @sollish/web test` → 450/450 geçti (yeni: exclusive/canlı masa/Ringside aralığı, 9 dilde `sx.*` anahtar şekli).
- `PLAYWRIGHT_SKIP_WEBSERVER=true PLAYWRIGHT_BASE_URL=http://localhost:3000 … test:browser tests/browser/lobby.spec.ts tests/browser/i18n.spec.ts --workers=1`
  → lobby.spec 21/21 geçti (axe 390 ve 1440, popover açıkken axe dahil); i18n.spec 2/3 — "slot settings dialog" testi
  /game/tarhun slot-kit ayarlarında dil değişimini bekliyor, lobiyle ilgisiz, paylaşılan dev sunucusunda diğer
  ajanların eşzamanlı düzenlemeleri sırasında başarısız (lobi dosyalarına dokunmuyor).
- Yalnız yerel dev sunucusu; build:cloudflare önizlemesi, barındırılan sürüm veya CI çalışmadı.
