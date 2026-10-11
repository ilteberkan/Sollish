# Ringside sonraki iş: maç içi öğrenme, gerçek zamanlı Jev, üst seviye animasyon

> 9 Ekim 2026: kararlar alındı ve iş yapıldı; güncel durum [STATUS.md](STATUS.md), ayrıntı sürüm günlüğünün 9 Ekim bölümü.

Kullanıcı isteği (9 Ekim 2026). Yeni oturum bu dosyayı, `AGENTS.md`'yi ve `docs/handoff/STATUS.md`'yi okuyarak başlar. Kullanıcıyla Türkçe, kısa ve kanıtlı konuş.

## Kullanıcının istediği
1. **Maç içinde öğrenen ve düşünen dövüşçü.** Önceden eğitilip dondurulmuş politika istenmiyor. Meyve sineği bağlantı ağı (MaleCNS) maç sırasında deneyimden öğrenecek; vuruş, seri, mesafe ve savunma seçimi elle yazılmış kurallar yerine bu öğrenen sistemden gelecek.
2. **TypeSafe Jev gerçek zamanlı çalışacak.** Bugün yalnız Combat Club'da stil etiketi seçiyor ve barındırılan sitede kapalı (`TYPESAFE_API_KEY` ve `DECISION_AGENT_ENABLED` hiç tanımlanmadı), bu yüzden API'de kullanım görünmüyor.
3. **Mükemmel animasyon.** Hem Combat Club (`/lab/ringside/play`, 3D) hem canlı oyun (`/live/ringside`, Gece Ligi 2.5D) için yürüme, ayak hareketi, vuruş ve tepki animasyonları basit ve hatalı. Kroşe ve aparkat ekranda düz yumruktan ayırt edilmiyor. Hedef, izleyicinin gerçekten izlemek isteyeceği bir yayın.

## İlk adım: kullanıcıdan alınacak kararlar
İşe başlamadan bunları sor; cevap yoksa koda geçme.
- **Değişmez kural değişikliği.** `AGENTS.md`: "Freeze rules, engine and policy for a match" ve "A learned policy needs real training and held-out evaluation evidence". Önerilen uzlaşma şu: öğrenme kuralı, başlangıç ağırlıkları ve hiperparametreler donar ve taahhüde girer; ağırlıklar maç içinde yalnız gözlenebilir sonuçlardan deterministik güncellenir. Böylece aynı seed aynı maçı yeniden üretir ve tarayıcı sonucu doğrulayabilir. Kullanıcı onaylarsa `AGENTS.md` metni buna göre güncellenir.
- **Jev'in rolü ve sınırı.**
  - Önerilen rol: tick düzeyinde karar vermez (45 sn × 20 Hz × 2 dövüşçü = 1.800 çağrı, maliyet ve gecikme kabul edilemez). Birkaç saniyede bir "köşe antrenörü" planı verir: niyet, tehdit okuması, hedef bölge; öğrenen ağ bu planı girdi olarak kullanır.
  - Bahisli LIVE'da Jev cevabı sonucu belirler. Bu nedenle her karar zaman damgası ve hash'iyle kayda girer, raunt sonunda yayınlanır; tarayıcı sonucu seed + karar kaydı ile doğrular. Jev cevap vermezse deterministik yedek devreye girer. Bu düzen bir adillik riskidir: gerçek varlık kapıları kapalı kalır, yalnız DEMO.
- **Anahtar ve bütçe.** `wrangler secret put TYPESAFE_API_KEY` ve `DECISION_AGENT_ENABLED` kullanıcı onayıyla yapılır. Değer `.tooling/secrets/typesafe.env` içinde; ekrana, loga veya commit'e yazılmaz. Maç başı çağrı ve token bütçesi kullanıcıyla sabitlenir.
- **Animasyon yolu.** İki seçeneği kısa prototiple yan yana göster:
  - (a) Three.js + lisanslı boks hareket yakalaması (repo'da `mixamo-boxing-v1.glb`, `cmu-boxing-v1.glb`; lisansları `public/models/boxing/*credits*` ve `.tooling/mixamo/`), kök hareketi, ayak kilidi ve temas IK'si.
  - (b) Gece Ligi 2.5D'nin 3/4 açılı, hareket yakalama referanslı yeniden yazımı.
  - Ücretli varlık veya lisans alımı kullanıcı onayı ister.

## Teknik iş (onaydan sonra)
1. **Yeni motor sürümü** (ör. `ringside-contact-5`). Contact 3 ve 4 bayt bayt korunur; kabul edilmiş biletler kendi motorunda sonuçlanır. Yeni namespace (`/v5`) ve SQLite sınıfı açılır.
   - **Öğrenen kontrolcü.** MaleCNS alt grafı üzerinde maç içi deterministik öğrenme. Aday yöntemler: aktör-eleştirmen veya ödül modülasyonlu plastisite. Ödül yalnız gözlenebilir olaylardan gelir: isabet, blok, yenilen darbe, kondisyon.
   - **Girdiler ve eylemler.** Gözlenebilir maç durumu ve Jev planı girdidir; bahis, bakiye, kasa ve gelecek seed asla girdi değildir. Eylem uzayı vuruş türü, seri devamı, mesafe ve savunma seçimini kapsar; elle yazılmış seçim kuralları kalkar, yalnız fiziksel uygulanabilirlik kuralları kalır.
   - **Kanıt.** Maç içi öğrenmenin gerçekten işe yaradığını held-out rakiplere karşı ölç (öğrenmesiz kopya, rastgele ağ, sabit stil). Bağlantı yapısının üstünlüğü gösterilemezse iddia edilmez.
   - **Denge ve tempo.** Mevcut v4 bandı korunur: taraflar %40–60, raunt başına 70'ten fazla vuruş, yere düşme %10–60.
2. **Jev servisi.**
   - Sunucu tarafında çalışır; anahtar yalnız sunucu ortamında durur.
   - Sınırlar: kapalı şema, 1,5 sn son tarih, deterministik yedek.
   - Karar kaydı taahhüt ve tekrar akışına bağlanır.
   - Testler: zaman aşımı, yinelenen istek, yeniden başlatma, yanlış biçimli cevap, bütçe tükenmesi.
3. **Animasyon.**
   - Her teknik ekranda ayırt edilmeli: jab, düz, ön ve arka kroşe, aparkat, gövde kroşesi. Ayrıca ayak işi (ileri, geri, yana adım, pivot), kafa kaçırma, eğilme, blok, sendeleme, düşüş ve kalkış, klinç, hakem.
   - Ölçülebilir kapılar:
     - temasta eldiven hedefe ≤3 cm;
     - eldiven ve kolun gövdeye girmesi ≤5 mm;
     - destek ayağı kayması ≤2 cm/adım;
     - 60 Hz'de sıçrama yok (mevcut `tests/ringside-broadcast.test.ts` ölçütü);
     - orta seviye telefonda 60 fps hedefi.
   - Combat Club'daki bilinen FAIL'ler (`STATUS.md`) bu işin parçasıdır.
4. **Doğrulama.** Protokol, web, realtime ve workerd testleri, tarayıcı paketi ve ekran görüntüsü kanıtı (`ops/evidence/`). Yayın yalnız kullanıcı onayıyla yapılır; önce realtime, sonra web.

## Mevcut temel (8 Ekim)
- Motor: `packages/protocol/src/combat-v4.ts`.
- Sunum: `apps/web/lib/ringside-night/broadcast.ts`, `components/ringside-broadcast-scene.tsx`.
- Önizleme: `/lab/ringside/night`.
- Jev: `apps/web/lib/server/typesafe-style.ts`.
- Kanıt: `ops/evidence/ringside-contact4-20261008.json`.
- Önizleme aracı Masaüstüne erişemiyor: sunucuyu kabuktan başlat, `.claude/launch.json`'daki "web-dev" ayarına bağlan.
