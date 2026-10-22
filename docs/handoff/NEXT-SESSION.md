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

## 20–21 Ekim oturumunda bitenler
- Yeni lobi, beş slot + Crash/Coinflip/Ringside/Ödüller/Stake/kütüphane çevirileri commit'li ve dalda. Tam yerel doğrulama `ops/evidence/full-verify-20261020/web.json` (ayrıntı STATUS.md). Kalan çeviri yalnız laboratuvar sayfaları (`app/lab/*`, `art-lab.tsx`).

## 22 Ekim: dalga 3
- Göreme ve Damla `claude/sollish-wave3-games` dalında oynanabilir (ayrıntı STATUS.md, `docs/product/games-wave3.md`). Kalan: Göreme seslendirmesi (onay), `build:cloudflare` önizlemesinde tarayıcı testleri, test sayfasına (artifact) iki oyunu eklemek, sahip kabulü.

## Sıradaki işler (öncelik sırasıyla)
1. (21 Ekim yapıldı) Test sayfası aynı adreste sürüm 6: lobi + beş slot + 9 dil + TR/EN ses, ~10,7 MB. Sunucu bileşeni olan güven/SSS bölümleri ve kabuk (yan menü) sayfada yok; sekme değişince oyun durumu sıfırlanır.
2. Ringside spec'lerini `NEXT_PUBLIC_API_URL=http://127.0.0.1:8787` ile ayrı bir `build:cloudflare` + yerel realtime üzerinde koş.
3. Sahip kararlarını bekle (aşağıda); yayın yalnız sahip isterse.

## Sahibin kararını bekleyenler
- Devnet yayını (web + realtime migration v7/v8), `SLOT_SIGNING_KEY`, `SLOTS_ENABLED=true`, `LIVE_RELAYS>0`.
- Asena ante RTP %94,26 (alt sınıra yakın) — yeniden ayar ister mi.
- Asena tavanlı satın alma turu normal hızda ~13 dk — kısaltılsın mı.
- Ringside için parçalı bahis defteri (`ringside-match-2`, ekonomi değişikliği).
- Ses dinleme kabulü (telaffuz: Ergenekon, Ay Ata, Elephant Clock, Tarhun kahkahası; Cascade sesi Skye).
- ElevenLabs gizli anahtarı yanlış alana bağlı (`api.elevanlabs.io`); düzeltmek için silip `api.elevenlabs.io`, başlık `xi-api-key`, önek boş ile yeniden eklenmeli. Şimdilik Higgsfield üzerinden üretiliyor.
- Çevirilerin anadil ve hukuk kontrolü (gerçek para öncesi); Portekizce Brezilya.
