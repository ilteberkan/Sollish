# Ringside Contact v3 — 3 Ekim 2026

[Canlı demo](https://sollish-web-devnet.sollish-web.workers.dev/live/ringside) · [İş emri ve kabul koşulları](../product/ringside-version-log.md) · [Kaynak kimlikli kanıt](../../ops/evidence/ringside-contact-20261003.json)

Bu sürüm gerçek para açılışı değildir. Kullanıcının dövüş, temas, raunt, görünür bahis bilgisi ve cüzdan yenileme taleplerine karşı uygulanmış değişikliktir.

## Uygulanan davranış

- V3'te geri çekilme döngüsü kaldırıldı. Yaklaşma, açı alma, gard ve sıyrılma; stamina/range kuralları ve saldırısız süre sınırıyla birlikte işler. Hasar süpürülmüş eldiven/ayak temasıyla hesaplanır. Baş, gövde, gard ve bacak hacimleri farklıdır; temas noktası aynı karede görsel IK hedefine dönüşür.
- 65 kemikli gerçek CC0 rig, ölçülmüş insan ölçeği ve iki kemikli IK kullanır. Jab/cross/hook/kick, ayak salınımı/duruş hedefleri ve hakem konumu replay'de kayıtlıdır. Kamera ve tarayıcı FPS'i sonuç girdisi değildir. Hakem kıyafeti ve instanced tribün katmanı güncellendi. Rig tıklaması KOR/AYAZ seçer; aynı eylemin klavye düğmeleri de vardır.
- En fazla üç raunt: 20 sn kabul, 45 sn simülasyon, 10 sn sonuç. Sonraki raunta sağlık +250/kondisyon +350 üst sınır 1000 ile taşınır. Durdurma maçı erken bitirir; dağıtım ilan edilmiş raunt sonundadır. Dört havuz tek raunt için bağımsızdır.
- Yeni `ContactArena` ayrı namespace kullanır. V2'nin kabul edilmiş biletleri `/live/ringside-v2` üzerinden aynı motor ve ekonomiyle devam eder. V1 ve SOLO yaşam döngüleri ayrıdır. Yeni motor kimliği ve sabit model SHA'sı kabul öncesi taahhüde bağlıdır.
- Desktop yayın/form/işlem defteri aynı çalışma alanında; mobil pazar/defter sekmeleri, görünür sayaç/hacim ve seçeneğe yatırılan tutarlar var. Kabul edilmemiş istekler hacme eklenmez. Online değeri bağlı oturumdur; insan doğrulaması değildir.
- Cüzdan tercihi saklanır ve önceki cüzdan `silent:true` ile tekrar bağlanır. Disconnect tercihi siler. Gecikmiş bağlantı/SIWS cevapları yeni bağlantıya uygulanmaz. İmza veya işlem otomatik onaylanmaz. Uzantıların `silent` uygulaması farklı olabilir.
- Yerel Crash/Coinflip'te bitmiş kaybeden oyunun gezinmeyle iadeye çevrilmesi kapatıldı; rezervasyon ve tek ödeme denetimleri eklendi. Yerel DEMO kodu/bakiyesi kullanıcı tarafından değiştirilebilir; gerçek fon güvenlik sınırı değildir.

## Öğrenme ve görsel sınır

[Gerçek öğrenme raporu](../../experiments/connectome/LEARNING.md): MaleCNS v1.0 CC BY 4.0 kaynağından 128 nöron/4.949 kenar. Sabit varsayımsal recurrent ağ üzerinde sentetik öğreticiyle çıkış katmanı eğitildi. Ayrı test bölümünde %86,66 etiket doğruluğu, 0,850 macro-F1; tekrar eğitim byte-identical model üretti. Karıştırılmış graf benzer sonuç verdi. Tam beyin, düşünme yetisi, kendi kendine dövüş öğrenme veya connectome üstünlüğü iddiası yoktur. Öğrenilmiş ağırlıklar maç/raunt içinde değişmez; recurrent hafıza her rauntta sıfırlanır.

Animasyonlar hazır Quaternius klipleri + prosedürel temas/IK katmanıdır. Yeni motion capture, tam mesh/ragdoll fiziği, bütün dövüş sanatları veya AAA karakter üretimi tamamlandı sayılmaz. Kaynaklar: [Quaternius](https://quaternius.com/packs/universalanimationlibrary.html), [Three.js AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html), [Wallet Standard](https://github.com/wallet-standard/wallet-standard/blob/master/packages/core/features/src/connect.ts), [Janelia MaleCNS](https://male-cns.janelia.org/download/). Supabase istemci giriş köprüsü mevcut [Web3 API'sini](https://supabase.com/docs/reference/javascript/auth-signinwithweb3) kullanır; veritabanı veya kimlik doğrulama ayarı değiştirilmedi.

## Doğrulama

| Kontrol | Sonuç ve kapsam |
|---|---|
| Workspace typecheck | PASS |
| Birim testleri | 164/164: protocol45, onchain45, realtime11, web41, worker22 |
| Üretim paketi tarayıcı | Yerel Cloudflare workerd, Chromium65/65; 0 fail/skip/flaky, 71,33 sn. Wallet ve transport fixture'ları gerçek uzantı/provider testi değildir. |
| Operasyon testleri | 28/28 |
| V3 gerçek yerel runtime | workerd/SQLite/WebSocket16/16: cutoff, duplicate, atomiklik, rollback, restart, ayrı ledger, raunt sağlık/score taşıma. Üçüncü-raunt-limit ve ilk-raunt-KO dallarında sağlık fixture'ları açıkça kaydedildi. |
| Legacy koruma | V1 runtime13, router12, V2 runtime12 PASS |
| Varlık ve gerçek rig | 5 binary asset +9 Three.js CPU testi PASS; 901 kare/47 temas. IK hedef eşleşmesi tam mesh çarpışması kanıtı değildir. |
| Öğrenme | 29 Python +4 TS parity testi; model yeniden üretimi ve ablation kayıtları |
| Görünürlük | 1440×900'de yayın/defter/form; 390×844'te form ve sekmeli defter görünür. 320/390 yatay taşma yok. DOM fixture ölçümü ve ayrıca canlı ekran gözlemi. |
| Yerel gerçek GPU | Apple M2/Chromium native Metal: 12 sn örnek, 29,96 FPS, p95 34,8 ms; ilk hazır 885 ms. Gerçek cihaz çeşitliliği veya küresel yük testi değildir. |
| Temizlik | Canvas0; buffer122/122 silindi, context teardown doğrulandı. Texture40/35 ve program25/17 explicit-delete; bütün GPU nesneleri için tek tek silme eşitliği iddia edilmez. |
| Public varlık taraması | 52 dosya, mevcut3 özel sunucu değeriyle tam eşleşme taraması,0 eşleşme. Genel secret-audit değildir. |

GitHub CI çalıştırılmış gibi raporlanmaz; yeni workerd komutu mevcut workflow'a eklendi.

## Gerçek hosted gözlem

Cloudflare'da iki bağımsız browser oturumu, fixture kullanılmadan maç1/raunt1'de altı bilet verdi. Havuz toplamı60 DEMO, iki katılımcı ve iki bağlı oturum iki istemcide eşleşti. Tek taraflı ilk-isabet ve yere-düşme havuzları kesintisiz iade edildi. Sonuç KOR/ilk-isabet KOR/yere-düşme yok/puanla; iki taraflı sonuç ve bitiş havuzları %2 kesintiyle dağıtıldı.

**2000 başlangıç DEMO = 1999,20 son bakiye toplamı +0,80 açık kesinti.** Her havuzda stake = dağıtım + kesinti. Tam altı kayıttan oluşan audit, seed taahhüdü, fullscreen, asset SHA ve build kimliği doğrulandı. İkinci raunta skor1:0, sağlık984/862 ve kondisyon1000/858 taşındı. Pageerror0, mobil yatay taşma yok. [Hosted kayıt](../../ops/evidence/ringside-contact-20261003/hosted.json).

Build `E0_AuJd5GJgtVyJllZ8fN`; web version `bafc065b-ef57-4f4f-b230-81f80793ae5f`; realtime version `fd489ab1-98ab-4aa9-8dc7-d010717747c9`. İkisi Cloudflare MCP'den %100 trafik olarak yeniden okundu. [Dağıtım kaydı](../../ops/evidence/ringside-contact-20261003-deployments.json).

## Açık kapılar

Gerçek SOL, token ödülleri ve mainnet kapalıdır. Dokuz protokol/oracle/gizlilik/ödeme/bağımsız inceleme kapısı hâlâ BLOCKED; yeni demo bunları geçirmiş sayılmaz. Havuz korunumu operatöre sonuca bağlı ek ödeme yükümlülüğü yüklememeyi sağlar; işletme giderlerinden sonra her koşulda kâr garantisi vermez. Binlerce eşzamanlı kullanıcı yükü, bağımsız güvenlik denetimi, fiziksel iOS/Android QA ve özel dövüş mocap'i tamamlanmadı.

Sonraki motor/model değişimi aynı kimlikle mevcut raunta uygulanamaz: yeni engine+namespace oluşturulmalı, bu motor/weights kabul edilmiş v3 biletlerini sonuçlandırmak için tutulmalıdır.
