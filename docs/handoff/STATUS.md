# Sollish durum

Son güncelleme: 11 Ekim 2026. Bu dosyayı yalnız güncel durumla tut. Oturum bitmeden veya context dolmadan güncelle; eskiyen kaydı [history.md](history.md)'nin başına taşı.

## Yayında olan (Cloudflare devnet)
- Web: `sollish-web-devnet`, version `93645ad3-1955-4f7d-b947-c495d6b604f6`, build `yTTEY4MG5gmewPMEL9MsM` (Combat Club `sparring-1`). Kök: https://sollish-web-devnet.sollish-web.workers.dev
- Realtime: `sollish-realtime`, version `fd489ab1-98ab-4aa9-8dc7-d010717747c9`.
- Bu kimlikler 4 Ekim'de Cloudflare MCP ile doğrulandı. Deploy öncesi yeniden doğrula.

## Yerelde hazır, yayımlanmamış
- **Candy Cascade (11 Ekim, yeni solo DEMO oyunu):** `/game/cascade`, motor `candy-cascade-1` (`packages/protocol/src/cascade.ts`). 6×5 her yerde öde, tumble, 4+ yıldız 10 bedava dönüş, kristal çarpanlar, azami 5.000×. Kullanıcı Sweet Bonanza'nın birebir kopyasını istedi; telif/marka nedeniyle bütün sanat, ad, paytable, ses ve animasyon özgün yapıldı (gerekçe `docs/product/candy-cascade-spec.md`). Simülasyonla RTP %95,82 (20 M tur, GA 95,2–96,4; sertifikasız). Ledger'a oyun başına ödeme tavanı eklendi (Cascade 5000×, diğerleri 50×). Testler: protocol 165, web 110, `cascade.spec.ts` 8/8 ve regresyon 23/23 yerel workerd preview'da (build `BKqxCrH1oqmvvcRxcBFjl`). Kanıt `ops/evidence/candy-cascade-20261011/`. Kullanıcı görsel kabulü, gerçek telefon ölçümü ve deploy yok.
- **Tekmeler, raunttan raunda öğrenme, yeni çizim (10 Ekim):** motor `ringside-contact-5-5d6b12d5` (kural v5m): tekme/diz; öğrenen durum (ağırlıklar, rakip modeli, dersler) maç boyunca raunttan raunda taşınır, iki beyin bağımsız. Önceden kayıtlı test: öğrenen rakiplere +38 (−2…+74), sabit tarzlara +20 (−5…+45) — ikisi de sıfırı içerdiği için GEÇMEDİ; eğitim etkisi +284. Denge: KOR %51, yere düşme %19, 42 vuruş, tekme %37 (tasarım bandı %35'i aştı, test tavanı %40'a çıkarıldı). Yayın klasik 2D dövüş oyunu: sabit yan kamera, Higgsfield kare kare sprite sayfaları (KOR, AYAZ 16+16 kare, hakem 12; `apps/web/scripts/ringside-frames.mjs`, `lib/ringside-2d/`); döndürmeli kamera kaldırıldı, Taktik görünümü duruyor; sonuç kartı kenarda ve kapatılabilir. Kanıt `ops/evidence/ringside-contact5-20261010/summary.json`.
- **Orkestra düzeni:** `~/.claude/CLAUDE.md` ve `~/.claude/agents/` (Opus yönetir, Sonnet kodlar, Haiku küçük iş).
- **Maç başına tek bilet (yeni, gece):** defter `ringside-match-1`. Bahis yalnız R1'den önce 30 sn; raunt aralarında kapalı; pazarlar kazanan, tam sonuç, yere düşme sayısı; havuzlar maç bitince bir kez sonuçlanır. Üç seed hash'i önceden yayımlanır, tarayıcı bütün maçı yeniden oynatır. Kanıt `ops/evidence/ringside-match-20261009.json`.
- **Yeni arayüz (Claude Design):** tuval https://claude.ai/artifact/Cu1K7TpsxUWFi73w6PpdM8. Dövüşçü üstünde halka + çarpan, dövüşçü kartları, maç kuponu (telefonda alttan açılır), maç akışı şeridi, canlı kupon takibi, yeni renkler, hap menü, yeni oyunlar sayfası.
- **Tek boks oyunu:** `/live/ringside`, motor `ringside-contact-5-dfd179bd` (kural v4b).
  - Eski boks sayfaları buraya yönlenir. 3D, GLB, Mixamo/CMU, Combat Club, araştırma sayfası ve `three` kaldırıldı; dosyalar silinmedi, `.tooling/archive/removed-20261009/` altında.
  - v2–v4 arenalarının sunucusu kabul edilmiş biletler için duruyor.
- **Tempo:**
  - Vuruş yalnız menzilde atılır; seri en çok 3 yumruk; seriden sonra toparlanma var.
  - Rauntta 54 vuruş (önce 97), yere düşme %24, KOR %48.
  - Jev planı 9 sn'de bir, raunt başına 5, maç başına 15 çağrı. Geçici hatada bir kez yeniden denenir.
- **Animasyon:** `apps/web/lib/ringside-25d/motion.ts` ve `components/ringside-broadcast.tsx`. Kodla yazılmış 2.5D: 3B iskelet, IK, adım planlayıcı, tekniğe göre eldiven yolu, darbe tepkisi, nakavt ve kalkış, klinç, hakem, uzun lens 3/4 kamera.
- Kanıt: `ops/evidence/ringside-live-20261009b.json`; sürüm günlüğünde "9 Ekim (akşam)".
- 5–8 Ekim işleri (Contact 4, Gece Ligi, sparring/neuro) ve sabahki Contact 5 kaydı: [history.md](history.md) ve [sürüm günlüğü](../product/ringside-version-log.md).
- Testler:
  - protocol 147, web 76 (hareket, tekme, kamera, sprite), realtime 11;
  - workerd v5 14/14 (maç defteri), v3/v4 16, v2 12;
  - tarayıcı (next dev) ringside 7/7 ve ürün 14/14 (WCAG dahil); operasyon 34;
  - tsc temiz, readiness exit 2.

## Bilinen FAIL ve açıklar
- **Öğrenme:** v5m'de maç içi öğrenmenin faydası ön kayıtlı kritere ulaşmadı (+38, aralık sıfırı içeriyor). Önceki: v4b'de maç içi öğrenme öğrenen rakiplere karşı fayda göstermedi (−2,6; −23..18). Sabit tarzlı rakiplere karşı +39 (25..53). Aynı kriteri kural v4 (`579c86bc`) geçmişti, ama orada yere düşme %12'ydi. Connectome üstünlüğü yok.
- **Animasyon:** kullanıcı görsel kabulü yok; telefon 60 fps ölçülmedi. Hızlı kroşede eldiven 60 Hz'de kare başına 36 cm'ye kadar gidiyor (yumruk hızı, sıçrama değil).
- **Doğrulama:** Playwright yalnız next dev'e karşı koştu; Cloudflare derlemesinde koşmadı. Barındırılan ortam yok.
- Dokuz gerçek varlık kapısı kapalı.

## Kullanıcı kararı bekleyen
1. Yayın: önce realtime (migration `v6`), sonra web. Barındırılan Jev için realtime worker'a `wrangler secret put TYPESAFE_API_KEY` + `DECISION_AGENT_ENABLED` + `JEV_CALL_BUDGET`. Hepsi onay bekler.
2. v4b (izlenebilir, öğrenme kriteri geçmedi) mi, v4 (kriter geçti, az yere düşme) mi?
3. Crash ve Coinflip sitede kalsın mı? (Şimdilik kaldı; yalnız boks oyunları teke indi.)
4. `.tooling/archive/` altındaki taşınmış dosyalar kalıcı silinsin mi? Kalıcı silmeyi kullanıcı kendisi yapmalı veya açıkça onaylamalı.
5. Ürün modeli s1 onayı.

## Sıradaki iş
1. Kullanıcının yeni arayüz ve animasyon geri bildirimi; telefon ölçümü; `build:cloudflare` önizlemesinde tarayıcı paketi.
2. Öğrenme: yere düşme oranını koruyan yeni bir kural, yeni ön kayıt ve yeni seed'lerle.
3. Belgeler: eski Combat Club/3D sayfalarına giden doküman bağlantılarını temizlemek.

## Ortam notları
- Git: repo commit'li (`main` + `claude/gifted-gauss-25dzjq`). Bulut oturumunda `scripts/use-node.sh` artık x64 Linux Node'u da indiriyor. Burada Playwright 1.63'ün beklediği Chromium 1243 yok; `/opt/pw-browsers/chromium-1194` `executablePath` ile kullanıldı.
- **Jev anahtarı:** yalnız `.tooling/secrets/typesafe.env`. Bugün 32 gerçek çağrı yapıldı, hepsi OK. Barındırılan ortamda tanımlı değil.
- Yerel canlı deneme şöyle yapılır:
  1. `apps/realtime` içinde `wrangler dev --port 8787 --env-file ../../.tooling/secrets/typesafe.env --var DECISION_AGENT_ENABLED:true --var JEV_CALL_BUDGET:N --var LIVE_ARENA_ENABLED:true --var ALLOWED_ORIGINS:http://localhost:3000`.
  2. Web için geçici `apps/web/.env.development.local` dosyasına `NEXT_PUBLIC_API_URL=http://127.0.0.1:8787` yaz; deneme bitince kaldır.
- Geliştirmede broadcast host'unda `ringPreview(seed)`, `ringSeek(ms)`, `ringRender(now)` kancaları var; üretimde yok.
- Eğitim: `experiments/ringside-learner/run-v4b.sh`; çıktılar `runs/rule-v4b/`. Her kural ayrı seed kullanır (`test4`, `test5`…).
- :3000'de önceden açık bir `next dev` vardı (bu oturum başlatmadı).
