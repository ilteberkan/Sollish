# Yeni oturum devri (20 Ekim 2026)

Önceki oturumun bağlamı doldu. Bu belge, yeni oturumun kaldığı yerden devam etmesi için tek giriş noktasıdır. Önce `AGENTS.md`, sonra `docs/handoff/STATUS.md`, sonra bu belge.

## Çalışma kuralları (sahip talimatı)
- Kullanıcıyla Türkçe, kısa ve kanıtla konuş. Orkestra şefi gibi çalış: ana oturum planlar, doğrular, commit eder; işler arka plan ajanlarına verilir. Zor tasarım/sanat/ses/oyun ekranı işleri Opus, mekanik çeviri ve üretim işleri Sonnet. Aynı anda en çok 3–4 ajan. Token maliyetine dikkat: ajanlara dosya yolu ve sözleşme ver, ana oturumda büyük dosya okuma.
- Dal: `claude/gifted-gauss-25dzjq`. Her ajan bitince testlerini doğrula, yalnız onun dosyalarını commit et, gönder. Ajan çalışırken düzenli WIP commit (`git add -A -- . ':!apps/web/next-env.d.ts'`). Commit öncesi gizli anahtar taraması. `git clean/reset/checkout` yok. Yayın (deploy) yalnız sahip isterse.
- Kullanım sınırı sık doluyor: ajan durursa aynı ajanı mesajla sürdür (yeni oturumda yeni ajan başlatılır; bu belge yeter). Konteyner yeniden başlarsa diskteki yarım işleri WIP olarak commit et.
- Tarayıcı: Playwright, `executablePath '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'` (`PW_CHROMIUM_PATH`). Bütün komutlar `bash scripts/use-node.sh …` ile. Geçici betikler scratchpad'de, repoda değil. `next-env.d.ts` geliştirme sunucusu yüzünden değişirse `next typegen` ile eski hâline döner.

## Bitenler (commit'li)
- Beş özgün slot: Candy Cascade, Tarhun, Ebru (`ebru-ink-1`), Cezeri (`cezeri-gears-1` v2), Asena (`asena-stars-1`); motor + 20 M tur RTP kanıtı + sanat + ses + oyun ekranı + RGS kaydı + /verify, /replay. Ayrıntı `docs/product/games-wave2.md`.
- Seslendirme: 5 oyun × tr/en, `apps/web/public/audio/voice/<oyun>/<tr|en>/`, sürüm etiketli ve kalıcı önbellekli. Dil `tr` ise Türkçe, diğer bütün dillerde İngilizce (`lib/slot-audio/voice-locale.ts`). Ses politikası `lib/slot-audio/voice-policy.ts`, ayarlarda "Ses anonsu" (Tam / Önemli anlar / Kapalı). Metinler `docs/product/voice-scripts.md`. Higgsfield'de ~20 kredi kaldı.
- i18n temeli (9 dil: en de pt fr it es tr zh ko): `lib/i18n/*`, `messages/<dil>/<ad alanı>.json`, `docs/architecture/i18n.md` (tarif + kalan iş listesi). Kabuk, lobi metinleri, doğrulama sayfaları ve slot kiti çevrildi.
- Ölçek: `docs/architecture/scale.md`; SlotMonitor parçalı (64), Ringside izleyici relay katmanı (varsayılan kapalı, migration v8), oyun başına paket bölme, ses/worker önbellek başlıkları, yük testi `ops/evidence/scale-20261016/`.
- Test sayfası (artifact, 5 oyun + dil seçici + EN/TR ses): https://claude.ai/artifact/NgZgQZHXnPTi8TDGZvU57N . Kurulum betiği önceki oturumun scratchpad'indeydi; yeniden yazmak gerekirse tarif: esbuild IIFE paket (`minifyWhitespace`+`minifySyntax`, tanımlayıcı küçültme yok, `.module.css` → `local-css`), `banner: var process={env:{NODE_ENV:"production"}}`, `next/navigation` için küçük bir taklit modül, ses worker'ı (`public/workers/slot-audio-render.js`) metin olarak gömülüp Blob URL ile `window.Worker` override, ses dosyaları base64 JSON olarak gömülüp `fetch` override (`/audio/voice/...`), Barlow fontları data URI ve `--font-barlow-face:'Barlow'`, uygulama `I18nProvider` ile sarılır (`loadNamespaces(locale, NAMESPACES)`), üstte dil düğmeleri (`useLocale().setLocale`) ve oyun sekmeleri. Aynı dosya yoluyla yayımlamak aynı adresi korur; yeni oturumda adresi korumak için `Artifact` aracına `url` verilir (önce `read`).

## Yarım kalanlar (WIP commit'lerde, son `b3c814a`)
1. **Yeni lobi** (Opus): `components/lobby/`, `lib/lobby/`, `app/lab/lobby-posters/`, `components/game-rich.tsx`. Hedef: masaüstü sol kategori menüsü, tablet ikon şeridi, telefonda alt sekme çubuğu; kahraman alanı; satırlar (Sollish Originals, Canlı, Anlık oyunlar, Yeni, Doğrulanabilir); arama, favoriler, son oynananlar; RTP/azami kazanç etiketleri `SLOT_GAME_META`'dan (motor import etme); özgün afişler; `/` lobi olsun (`/games` çalışmaya devam). bet365/888 yalnız düzen referansı, marka/görsel kopyası yok. Son durum: "ana lobi bileşeni (çipler, satırlar, ızgara) yazılıyordu".
2. **Çeviri — Tarhun, Candy Cascade, Ebru** (Sonnet): Tarhun büyük ölçüde bitti, Cascade kısmen, Ebru oyun ekranı yamasında kaldı. `messages/*/tarhun.json`, `cascade.json`, `ebru.json` var.
3. **Çeviri — Cezeri, Asena, ortak** (Sonnet): Cezeri büyük ölçüde bitti ("başlangıç turları, tekrar, otomatik oyun" bloğunda kaldı), Asena ve `game-common.tsx` `Rules`, `lib/slot-verify.ts`, `lib/rgs-client.ts` (`rgsErrorMessage`), `lib/demo.ts`, `lib/tokens.ts` kaldı.
- Kural: Türkçe metin bayt bayt aynı kalır (tarayıcı testleri Türkçe adlara bakar; test ayarı `tr` zorlar). Anahtar eşliği testi (`tests/i18n.test.ts`) geçmeli. Kalan liste `docs/architecture/i18n.md` "Kalan" bölümünde.

## Sıradaki işler (öncelik sırasıyla)
1. Yukarıdaki üç yarım işi bitir (her biri kendi testleri + ekran görüntüsü), commit et.
2. Kalan çeviriler: Crash, Coinflip, Ringside, Ödüller/Stake, kütüphane mesajları.
3. Tam doğrulama: `build:cloudflare` (tek başına), `preview:cloudflare` üzerinde bütün tarayıcı testleri (product, i18n, beş slot, lobi), sonuçları `ops/evidence/` altına.
4. Test sayfasını yeni lobi + tam çeviriyle güncelle, sahibe bağlantıyı ver.
5. `docs/handoff/STATUS.md` güncelle.

## Sahibin kararını bekleyenler
- Devnet yayını (web + realtime migration v7/v8), `SLOT_SIGNING_KEY`, `SLOTS_ENABLED=true`, `LIVE_RELAYS>0`.
- Asena ante RTP %94,26 (alt sınıra yakın) — yeniden ayar ister mi.
- Asena tavanlı satın alma turu normal hızda ~13 dk — kısaltılsın mı.
- Ringside için parçalı bahis defteri (`ringside-match-2`, ekonomi değişikliği).
- Ses dinleme kabulü (telaffuz: Ergenekon, Ay Ata, Elephant Clock, Tarhun kahkahası; Cascade sesi Skye).
- ElevenLabs gizli anahtarı yanlış alana bağlı (`api.elevanlabs.io`); düzeltmek için silip `api.elevenlabs.io`, başlık `xi-api-key`, önek boş ile yeniden eklenmeli. Şimdilik Higgsfield üzerinden üretiliyor.
- Çevirilerin anadil ve hukuk kontrolü (gerçek para öncesi); Portekizce Brezilya.
