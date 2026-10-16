# Platform kararları

Kullanıcının verdiği, koddan çıkarılamayan kalıcı kararlar. Kaynak: [4 Ekim devir belgesi §1, §7, §8](../handoff/archive/2026-10-04-opus-5-5-handoff.md). Ringside'a özgü kararlar [şartnamededir](ringside-neuroarena-spec.md).

## Ürün
- Solana üzerinde non-custodial platform. Başlangıç: Coinflip + canlı, manuel cash-out zorunlu Crash. Bahis cüzdandan sözleşmeye, doğrulanmış ödeme kayıtlı oyuncuya gider. "Anında" ödeme bir gecikme garantisi değildir.
- Özgün 3D oyunlar ortak mimarinin parçası; ilki Ringside. Referans mekanik seviyesi Fight Arena Online ve Punchers. Rakibin kodu, modeli, markası veya lisanssız animasyonu kopyalanmaz.
- Canlı chat ve saatlik airdrop zorunlu. Airdrop platform token'ı ile yapılır, SOL ile değil. Chat yazma hakkı son kayan 60 dakikadaki finalized bahis hacmine bağlı; kesin minimum bir ürün parametresidir, uydurulmaz. Saatlik ödül UTC epoch'u ile, chat penceresi kayan 60 dakika ile hesaplanır; ikisi aynı pencere değildir.
- Token: toplam arz hedefi 1.000.000.000; aşamalı oyun ödülleri, staking, fonlanmış ödül havuzları, ileride buyback/burn. %70 oyun / %15 staking / %10 airdrop / %5 topluluk önerisi edinilmiş ödül rezervi içindir, toplam arzın otomatik dağıtımı değildir. Pump.fun launch ve marketing platform tamamlandıktan sonra yapılır; launch izni veya bütçe kararı değildir.
- Planlanan mainnet house sermayesi 1 SOL. Bu bir cüzdan bakiyesi değildir; devnet SOL'ü, operasyon, audit, asset ve token bütçeleri ayrıdır. House teminatı ve staking anaparası buyback bütçesi değildir.
- Hedef global erişim. Bu, her ülkede koşulsuz gerçek bahis açma veya hukuk ya da sağlayıcı koşullarını atlama kararı değildir.

## Altyapı
- Cloudflare (web + realtime Durable Objects) + managed Supabase (`lutwdmwkogtzajxvbuiy`) + mevcut ARM VPS (`ssh sunucum`). Binlerce kullanıcı için yeniden yazım istenmiyor; kota ve kapasite ölçülerek büyütülür. Ücretsiz planların sınırsız yük taşıdığı söylenmez.
- Native WebSocket/DO kullanılır; Socket.io'ya geçilmez. Wallet bağlantısı ile SIWS oturumu farklı şeylerdir.
- MagicBlock PER'in TDX güven modeli ARM VPS'te barındırılamaz. Cloudflare Worker veya Edge Function TEE yerine konmaz.
- Ayrıntılar: [backend](../backend.md), [hosting](../hosting.md), [operations](../operations.md), [scaling](../scaling.md).

## Arayüz
- Modern, koyu, özgün ve mobil uyumlu bir yayın ekranı; oyunun kendisi öne çıkar. Okunaklı sabit genişlikli rakamlar, az sayıda anlamlı vurgu. Eş kart duvarları, süs gradientleri, neon/cam efekti yığını, oversized hero metni ve sahte işlem ya da oyuncu akışı kullanılmaz. Ayrıntı: [tasarım brief'i](../design-brief.md).
- Kontroller 320/390/768/1440 px'te, desktop 1280×720'de kaydırmasız; dokunma hedefleri 44–48 px; klavye, focus, reduced motion ve context-loss desteklenir.
- Fiziksel telefon testini kullanıcı daha sonra yapacak. Emülasyon sonucu fiziksel cihaz testi olarak raporlanmaz.

## 16 Ekim 2026 — dil, seslendirme, lobi, ölçek (sahip kararı)
- **Diller:** site ve oyunlar en, de, pt, fr, it, es, tr, zh (Basitleştirilmiş), ko. Varsayılan en; kullanıcı seçimi çerez `sollish_locale`. Ayrıntı `docs/architecture/i18n.md`. Gerçek para öncesi anadil kontrolü gerekir.
- **Oyun seslendirmesi:** varsayılan İngilizce; yalnız kullanıcı dili Türkçe ise Türkçe sesler çalar; diğer bütün dillerde İngilizce. Dosyalar `apps/web/public/audio/voice/<oyun>/<tr|en>/`. Sesler özgün, profesyonel, oyunun karakterine uygun ve kullanıcıyı sıkmayacak sıklıkta (ortak ses politikası, ayarlarda "Ses anonsu: Tam / Önemli anlar / Kapalı").
- **Lobi:** bet365 Casino ve 888casino arayüzleri yalnız düzen ve kullanılabilirlik referansıdır (sol kategori menüsü, kahraman alanı, oyun satırları, rozetler, arama). Sollish lobisi daha modern, daha duyarlı (responsive), daha kullanışlı ve özgün olacak; başka sitelerin markası, görseli veya metni kullanılmaz.
- **Ölçek:** hedef milyonlarca eşzamanlı izleyici/oyuncu; en büyük operatörlerin desenleri (durumsuz kenar, oyuncu başına cüzdan parçalama, idempotent ödeme, CDN'de değişmez varlıklar, hiyerarşik yayın dağıtımı, bölgesel dayanıklılık, gözlemlenebilirlik). Kapasite modeli ve kanıt `docs/architecture/scale.md`, `ops/evidence/scale-*`. Barındırılan doğrulama ve yayın sahibin onayını bekler.
