# Oturum geçmişi

[STATUS.md](STATUS.md)'den eskiyen kayıtlar buraya, en yenisi en üstte olacak şekilde taşınır. Varsayılan olarak okunmaz; bir kararın nedenini veya eski bir ölçümü ararken bak.

## 9 Ekim 2026 (sabah–öğleden sonra) — Contact 5 ilk sürüm
- Contact 5 `ringside-contact-5-78ccfa82`: maç içi öğrenen dövüşçü, 6 sn'de bir Jev köşe planı, `ContactArenaV5` `/v5`, migration `v6`. Kural v3 ana kriteri geçmedi; sabit tarzlı rakiplere +43. Denge: 97 vuruş/raunt, yere düşme %41.
- Animasyon A/B prototipi `/lab/ringside/motion` (Mixamo + IK; A 3D, B Canvas 2.5D). Akşam kullanıcı 2.5D'yi seçti ve 3D'yi kaldırttı; prototip `.tooling/archive/removed-20261009/` altında.
- Yerel canlı deneme: 16/16 Jev planı, raunt 3 bütçe yedeği. Kanıt `ops/evidence/ringside-contact5-20261009.json`.

## 6–8 Ekim 2026 — yeni kadro, Gece Ligi, Contact 4 (STATUS'tan taşındı 9 Ekim)

### 6 Ekim: yeni gerçekçi kadro
- CC0 MakeHuman boksörler (KOR, AYAZ) ve hakem, mevcut Quaternius iskeletine giydirildi; bütün mevcut klipler değişmeden çalışıyor. `/lab/ringside/play?cast=mh` ile açılır, varsayılan kadro aynı.
- Üretim: `scripts/boxing-assets/makehuman/` (Blender 5.2.2 + MPFB 2.0.17, `.tooling/blender`). Lisans ve hash: `apps/web/public/models/boxing/athlete-mh-v1-credits.json`. Görüntüler: `ops/evidence/ringside-cast-mh-20261006/`.
- Kontrol: iskelet dinlenme dönüşü farkı ≤0,036°, taban z=0, web unit 92/92, typecheck temiz. Tarayıcı paketi bu kadroyla koşturulmadı.
- Açık: eldivenler prosedürel taslak, deri yalnız renk dokusu (normal map yok), hakem gömleğinde koyu leke, seyirci hâlâ basit.
- Aynı gün: yeni kadro Combat Club'da varsayılan oldu (`?cast=classic` eskisi). Yayın katmanı eklendi: bloom ve renk ayarı, darbe sıçraması, kamera sarsıntısı, seyirci flaşları, çağrı yazıları ve yere düşmede iki açılı yavaş çekim tekrarı (`?fx=0` kapatır). Kanıt: `ops/evidence/ringside-broadcast-fx-20261006/`. Yayımlanmadı.

### 8 Ekim: Gece Ligi yayın görünümü (yerelde hazır, yayımlanmadı)
- `/live/ringside` varsayılanı yeni 2.5D tuval yayını; eski 3D sahne **3D** düğmesi veya `?scene=3d`. Motor ve ödeme değişmedi. Önizleme: `/lab/ringside/night`. Tasarım: Claude Design "Ringside Görsel Yönü".
- Kanıt `ops/evidence/ringside-gece-ligi-20261008.json`: temas 474/474 (≤2,5 cm), web 96/96, protokol 105/105, tarayıcı 82/82 (önizleme :3001, build `DINV9x3S-RPMG7kNXj6Aa`).
- Açık: kullanıcı görsel kabulü, telefon testi; Combat Club ve eski sayfalar hâlâ 3D.

### 8 Ekim (devam): Contact 4 — yerelde hazır, yayımlanmadı
- `/live/ringside` artık Contact 4 (`ringside-contact-4-f8cd1d1f`) + Gece Ligi yayını; Contact 3 `/live/ringside-v3` ve `/v3`'te kaldı. Sunucu: `ContactArenaV4`, `/v4`, migration `v5`.
- Kanıt `ops/evidence/ringside-contact4-20261008.json`: protokol 111/111, web 100/100, realtime 11/11, workerd v3+v4 geçti, tarayıcı 89/89 (build `CHDaObcMu5nfY-wNXYcTI`), readiness exit 2.
- Yayın sırası: önce realtime (`wrangler deploy`, v5 migration), sonra web. İkisi de kullanıcı onayı bekler.

## 6 Ekim 2026 — talimat dosyaları sadeleştirildi
- 488 satırlık `CLAUDE_OPUS_5_5_HANDOFF.md` bölündü: kalıcı kurallar ve komutlar `AGENTS.md`'ye, platform kararları `docs/product/platform-decisions.md`'ye, güncel durum `STATUS.md`'ye taşındı. Özgün belge değiştirilmeden [arşivde](archive/2026-10-04-opus-5-5-handoff.md) duruyor.
- Şartnamenin tarihli ekleri birebir `docs/product/ringside-version-log.md`'ye taşındı; şartnamede ilkeler ve sürüm haritası kaldı.
- 4 Ekim paralel inceleme planları 5 Ekim'de uygulandığı için [arşive](archive/2026-10-04-ringside-next-session-plans.md) alındı.

## 4–5 Ekim 2026 ve öncesi
Devam kayıtları 1–7 (`sparring-2` … `sparring-5`, Mixamo, NeuroBoxer v1/v2, Jev): [arşivlenmiş devir belgesi §14](archive/2026-10-04-opus-5-5-handoff.md).
