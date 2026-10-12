# Sollish oyun standardı

Durum: 11 Ekim 2026, sahip kararı. Bundan sonraki bütün Sollish oyunları (slot, tumble, crash, kart, canlı) bu belgeyi karşılamadan "bitti" sayılmaz. Hedef seviye: önde gelen online oyun stüdyolarının (Pragmatic Play, Hacksaw, Nolimit City, Push Gaming, Relax) ticari oyunları. Hedef **kalite ve özellik eşitliğidir; kopya değildir**.

## 1. Özgünlük (kesin kural)
- Ad, logo, karakter, sembol çizimi, arka plan, arayüz düzeni, animasyon, müzik, ses efekti ve ödeme tablosu **özgündür**. Başka bir oyunun "birebir" kopyası veya küçük değişiklikli kopyası yapılmaz; kullanıcı istese de.
- Tür mekanikleri (tumble, scatter pays, çarpan, bedava dönüş, ante, bonus satın alma, megaways vb.) serbesttir; parametreler kendi Monte Carlo ayarımızdan gelir.
- Üçüncü taraf varlık yalnız açık lisansla (CC0/CC-BY/satın alınmış) ve `credits.json` kaydıyla kullanılır. Satın alma kullanıcı onayı ister.

## 2. Motor ve ekonomi
- Saf, deterministik motor (`packages/protocol`), seed + bahis + mod → tam tur. Sunum sonucu değiştiremez.
- Tam sayı aritmetik; azami kazanç tavanı; her mod için (standart, ante, satın alma) ayrı RTP.
- Her mod için ≥10 milyon turluk simülasyon kanıtı: RTP ve %95 GA, isabet sıklığı, özellik sıklığı, oynaklık (standart sapma), azami gözlenen kazanç. Kanıt `ops/evidence/<oyun>-<tarih>/`.
- Davranış değişikliği yeni motor kimliği ister (`<oyun>-N`); eski motor tekrar oynatma için dondurulur.
- Tur kimliği ve seed kaydı; geçmişten aynı turu **tekrar oynatma**.

## 3. Zorunlu oyuncu özellikleri
| Alan | Asgari |
|---|---|
| Bahis | Sabit bahis basamakları, −/+ düğmeleri, bahis menüsü, azami bahis kısayolu; mod maliyeti (ante, satın alma) açıkça gösterilir |
| Dönüş | Normal, **hızlı** ve **turbo** dönüş; Boşluk tuşu; kazanç sayacını dokunarak atlama; "giriş ekranlarını atla" |
| Otomatik oyun | 10/25/50/100/250/500/1000 tur; **kayıp limiti zorunlu**; durma koşulları: her kazançta, bedava dönüşte, tek kazanç ≥ X, bakiye artışı ≥ X; kalan sayıyı gösteren durdur düğmesi; sekme gizlenince durur |
| Özellikler | Varsa ante ("Şans ×2") ve bonus satın alma onay penceresiyle; satın almada fiyat ve ayrı RTP |
| Ses | Ayrı **müzik**, **efekt**, **ortam** ses düzeyi + ana sessiz; temaya göre müzik (temel, özellik, büyük kazanç); geçişlerde crossfade; büyük kazançta ducking; gizli sekmede durur; ayarlar tarayıcıda hatırlanır |
| Bilgi | Çok sayfalı oyun bilgisi: nasıl oynanır, ödeme tablosu (bahse göre DEMO tutarları), özellikler, RTP (her mod), azami kazanç, bahis aralığı, tuşlar, arıza hükmü |
| Geçmiş | Tur listesi (zaman, bahis, mod, kazanç, tur kimliği) ve tekrar oynatma |
| Sorumlu oyun | Oturum süresi ve net sonuç göstergesi; 30 dakikada bir hatırlatma (devam / çık); DEMO'da "bakiyeyi yenile" |
| Erişilebilirlik | Klavye, odak, ekran okuyucu duyuruları, `prefers-reduced-motion`, renk körlüğünde ayırt edilen semboller |
| Görünüm | Telefon dikey + masaüstü; yükleme ekranı; 60 fps hedefi orta seviye telefonda; yalnız transform/opacity animasyonu |

## 4. Sunum kalitesi
- Her sonuç adımı için animasyon: giriş, kazanç vurgusu, patlama/parçacık, düşme, çarpan, özellik tetikleme, özellik girişi ve çıkış özeti, büyük kazanç kademeleri (≥20×, ≥50×, ≥100×, azami).
- Ses tasarımı katmanlı: her olay için ayrı efekt, perde/şiddet değişkeni, tekrar yorgunluğunu önlemek için varyasyon; miks master limiter ile kırpılmadan.
- Müzik: döngü dikişsiz, en az 30 saniye; özellik müziği ayrı tema; stinger'lar ölçüye oturur.

## 5. Doğrulama
- Motor birim testleri, zaman çizelgesi testleri, tarayıcı testleri `build:cloudflare` önizlemesinde.
- Otomatik oyun durma koşullarının ve kayıp limitinin testleri.
- Kanıt: komut, sonuç, build kimliği. Kullanıcının görsel ve işitsel kabulü ayrı kaydedilir.
- DEMO dışı (gerçek varlık) kapılar bu standarttan bağımsız olarak kapalı kalır.

## 6. Oyun akışı kuralları (sahip kararı, 12 Ekim 2026)
- **Dönüş kilidi:** Dönüş düğmesine bir kez basılınca tur (bütün düşmeler ve bedava dönüşler dahil) bitene kadar düğme ve Boşluk tuşu devre dışıdır. Aynı düğme "atla/durdur" olmaz; oyunu hızlandırmak için hızlı/turbo ayarı kullanılır. Kazanç sayacını kutlama ekranına dokunarak hızlandırmak serbesttir; sonucu ve ödemeyi değiştirmez.
- **Birikimli kazanç:** Kazanç göstergesi tur boyunca sıfırlanmaz; düşmeler ve bedava dönüşler boyunca toplanır. Tur sonunda toplam kazanç ekranı gösterilir.
- **Kazanç kademeleri** (tur toplamı / taban bahis): Büyük ≥10×, Mega ≥25×, Süper ≥50×, Efsane ≥100×, ayrıca tavana ulaşan tur için Azami Kazanç. Sayaç kademeler arasında tırmanır; her kademenin kendi ekranı, rengi, parçacık efekti ve müziği vardır. Bedava dönüş turu her zaman "toplam kazanç" ekranıyla biter.
- **Çarpan anonsu:** Büyük çarpanlar (≥10×) ekranda kendi büyük yazısı ve kendine özgü sesiyle duyurulur; oyunun karakteri varsa kendi seslendirmesiyle.
- **Otomatik oyun ekranı sade olur:** ana görünümde yalnız tur sayısı, kayıp limiti (zorunlu) ve Başlat. Diğer durma koşulları ("her kazançta", "bedava dönüşte", "tek kazanç şu tutarı aşarsa", "bakiye şu kadar artarsa") kapalı bir "Gelişmiş" bölümündedir.
