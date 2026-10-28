# Ringside'a girilemiyor (28 Ekim 2026)

**Belirti (yeniden üretildi):** `pnpm dev` (veya `NEXT_PUBLIC_API_URL` olmadan yapılmış `build:cloudflare`) ile `/live/ringside`
açılıyor ama sahne sonsuza dek "BAĞLANIYOR · Arenaya bağlanılıyor" gösteriyor; bahis penceresi hiç gelmiyor.

**Kök neden:** Ringside paylaşılan bir LIVE oyun; maçı `apps/realtime` yürütür ve web ona `NEXT_PUBLIC_API_URL` üzerinden
WebSocket ile bağlanır. Yerel `pnpm dev` bu sunucuyu açmıyor ve adres boş; `lib/use-ringside.ts` `NOT_CONFIGURED` veriyor,
arayüz bunu "bağlanıyor" diye gösteriyordu. Oyun motoru veya defter kusuru yok.

**Düzeltme:**
- `pnpm dev:live` (`scripts/dev-live.sh`): realtime `wrangler dev` :8787 (yerel origin'lere izinli) + web :3000,
  `NEXT_PUBLIC_API_URL=http://localhost:8787`. Ctrl+C ikisini de kapatır.
- Sunucu yapılandırılmamışsa sahne "ÇEVRİMDIŞI · Canlı arena çevrimdışı" + "Lobiye dön" gösterir (masaüstü ve telefon,
  9 dil); sonsuz "bağlanıyor" kalktı. Sonuç, ödeme ve defter yoluna dokunulmadı.

**Doğrulama (yalnız yerel, dev sunucusu):**
- `dev:live` ile `/live/ringside`: CANLI, Maç #1, bahis sayacı, raunt 1 akıyor (`live-dev-live.png`).
- `ringside-contact.spec.ts` + `ringside-film.spec.ts` 8/8 (`dev:live` sunucusuna karşı).
- Sunucusuz: çevrimdışı uyarısı 1440 ve 390 px'te görünür, "Lobiye dön" `/` adresine götürür (`offline-1440.png`, `offline-390.png`).
- web birim 455/455, typecheck temiz, lobby + i18n tarayıcı 24/24.
- Hosted devnet bu konteynerden erişilemedi (proxy `connect_rejected`); yayındaki sürüm doğrulanmadı.
