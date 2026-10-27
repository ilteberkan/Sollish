# Sollish Originals oyun sayfası (Coinflip, Crash, Damla) — 27 Ekim 2026

Referans: sahibin "Lucky" CoinFlip Originals ekranı (yalnız yerleşim; logo, ad, para portresi ve oyun görselleri kullanılmadı).
Sözleşme: `docs/product/design-system.md` (yalnız `--sx-*` tokenları). Ekranlar: `before-*` değişiklik öncesi, `after-*` sonrası,
1440×900 ve 390×844, ilk ekran + tam sayfa (`-full`). Yerel `next dev` (127.0.0.1:3000); kabuk aynı anda başka ajanca değişiyordu.

## Referans öğesi → Sollish öğesi
| Referans | Sollish |
|---|---|
| Sol bahis paneli kartı | `components/originals/originals-page.tsx` `OriginalsTable` (Damla: kendi `.table`, panel `order:-1`) |
| Manual / Auto sekmesi | `BetPanel` (Radix Tabs) "Manuel / Otomatik"; Otomatik = slot-kit `AutoplayPanel` (kayıp limiti zorunlu, sekme gizlenince durur) |
| Bet Amount + ½ + 2× | `BetAmountField` "Bahis tutarı" (Coinflip/Crash serbest tutar, 1–500 DEMO, bakiye tavanı); Damla: bahis basamakları üzerinde ½/2× (`lib/originals.ts ladderHalf/ladderDouble`), −/+ ve Azami bahis korunur |
| Kirk / Floyd sarı-gri seçim | Coinflip `ChoiceToggle` Yazı (sarı seçili) / Tura (gri) |
| (oyuna özel seçim) | Crash: "Otomatik çıkış" hedefi (1,50/2/5/10× + serbest, 1,01–50×); Damla: risk + teras |
| Total Profit | `ProfitReadout` "Toplam kâr": Coinflip kazanırsan net (×1,96); Crash hedefte / anlık / son tur; Damla son basış neti (telefonda gizli, "Kazanç" hücresi var) |
| Büyük yeşil düğme | lime `action` (Demoda çevir / Demoyu başlat–Çıkış yap / Damla) |
| Oyun alanı | mevcut sahne ve animasyonlar; panel arka planı `--sx-lime-soft` → `--sx-bg` |
| Bilgi şeridi ikonları | `InfoBar`: Ayarlar (yalnız ayarı olan Damla'da), Tiyatro modu, Tam ekran, Favori yıldız; ortada sollish wordmark |
| Provably Fair | Damla: `/verify` bağlantısı. Coinflip/Crash: tarayıcı rastgeleliği, kanıtlanabilir adil DEĞİL → bağlantı yok, "Pratik · kanıtlanabilir adil değil" |
| Oyun kartı (Original, RTP, I'm feeling lucky) | `GameStrip`: lobi posteri, ad, "Original", "RTP %98,00" (Coinflip/Crash, lib/lobby/stats), Damla seçili modun tam RTP'si; "Şansımı dene" = şu anki bahisle normal bir DEMO turu (Coinflip rastgele taraf seçer; sonuç ayrı çekilir) |
| Originals renkli kart satırı | `OriginalsRow`: Crash, Coinflip, Damla lobi posterleri; açık oyun "Şu an oynuyorsun" |
| Mobil | ≤860px: sahne üstte, bahis paneli altta |

## Davranış
Defter/ödeme yolları aynı (reserve/settle bir kez; Geri/unmount iadesi; gizli sekme dönüşte tamamlanır). Yeni: Crash otomatik
çıkış hedefi — sonuç yalnız çöküş noktasından (`crashTargetOutcome`: nokta ≥ hedef ise tam hedef öder), kare zamanlamasından değil;
unmount'ta geçilmiş hedef ödenir. Coinflip/Crash Otomatik: her tur normal manuel turla aynı yol, kayıp limiti tur ÖNCESİ kontrol.

## Kanıt (27 Ekim 2026, yerel)
- `pnpm --filter @sollish/web typecheck`: geçti.
- `pnpm --filter @sollish/web test`: 455/455 (yeni `tests/originals.test.ts`: ½/2× matematiği, basamak, hedef ayrıştırma, hedef ×2 RTP ≈ %98 Monte Carlo, kâr).
- Tarayıcı (next dev, workers=1): `originals.spec.ts` (yeni, 8) + `product.spec.ts` + `damla.spec.ts` = 30/30; `solo-lifecycle` + `demo-entropy` + `game-info` + `wallet-reconnect` + `i18n` 28/29, tek hata (Coinflip erken Geri) tekrarlarda 15/15 geçti — eşzamanlı HMR kaynaklı kararsızlık.
- Hosted / build:cloudflare önizleme / CI: çalıştırılmadı. Sahibin görsel kabulü ayrıdır.
