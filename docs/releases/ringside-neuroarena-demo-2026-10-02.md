# Ringside Lab v2 — 2 Ekim 2026

Yayın: https://sollish-web-devnet.sollish-web.workers.dev/live/ringside

Ürün/talimat: [NeuroArena şartnamesi](../product/ringside-neuroarena-spec.md). Makine okunur kabul: [sürüm kanıtı](../../ops/evidence/ringside-neuroarena-20261002.json).

## Değişen davranış

Önceki LIVE, 5 saniye bahis topluyor, eşit olasılıkla bir kazanan seçiyor ve 8,8 saniyelik koreografiyle sabit 1,96× demo ödeme yapıyordu. Yeni ayrı v2, 20 saniye bahis toplar; açıklanan seed ile 60 saniyelik reaktif dövüş simülasyonu gösterir; 10 saniye sonuç verir. Eski endpoint/biletler kendi kurallarıyla korunur.

Yeni motor mesafe, ring sınırı, stamina, saldırı hazırlığı ve gözlenen saldırı tekrarını kullanır. Hareket, guard, slip, jab, cross, hook, kick, knockdown ve recovery olayları üretir. Bunlar kinematik oyun kurallarıdır; biyolojik sinir sistemi, eğitimden geçmiş politika, yüksek doğruluklu temas fiziği veya tam MMA kuralları değildir.

Dört bağımsız pari-mutuel DEMO pazar: maç sonucu, ilk temiz isabet, yere düşme, bitiş şekli. Normalde %2 toplam havuz kesintisi; tek taraflı/boş/kazanan bileti olmayan havuzlarda tam iade. Kazananlar yalnız havuzdan ödenir, kasa ek ödeme üstlenmez. Doğru seçimin dönüşü stake'den düşük olabilir; net işletme kârı garanti edilmez. SOLO sabit oranlı oyunlar bu ekonomiyle değiştirilmedi.

Public tape gerçek kabul kayıtlarıdır: bağlı benzersiz demo oturumu, katılımcı, toplam tutar, seçim payları, son 30 makbuz ve mevcut maçın tüm makbuzlarının JSON dökümü. Seed taahhüdü kapanıştan önce, seed kapanıştan sonra açıklanır; tarayıcı hash ve sonucu doğrular. Bu, bağımsız VRF veya operatörün seed seçimine karşı kanıt değildir.

Three.js sahnesinde üçüncü rigli hakem, reaktif replay animasyonu, hazır yürüyüş/toparlanma klipleri, prosedürel tekme, hareketli kadraj, üstten taktik kamera ve tam ekran bulunur. 14 hazır klip ve lisanslı CC0 taban korunur. Yeni özel motion capture veya AAA sanat üretildiği iddia edilmez.

## Araştırma ve gerçek veri

[MaleCNS raporu](../../experiments/connectome/README.md): gerçek 1.051.241.946 bayt bağlantı dosyası indirildi ve tamamı Arrow batch'leriyle tarandı. 151.856.684 ham segment satırı; iki ucu `Traced` görünümünde 25.563.197 satır. Şema, kaynak, lisans ve SHA-256 kayıtlı. Bu işlem CSR, sinir dinamiği veya öğrenme üretmedi.

[TypeSafe/Jev adaptörü](../../experiments/decision-agent/README.md): resmî endpoint/model/sözleşme pinli, varsayılan kapalı, allowlist, deadline, sınırlı eylemler ve güvenli telemetry. Gerçek sağlayıcı çağrısı, API harcaması veya key saklama yapılmadı. Jeeves fizik veya ödeme motoru değildir.

## Doğrulama

| Kontrol | Sonuç / sınır |
|---|---|
| Workspace typecheck | PASS |
| Workspace birim testleri | 133 PASS (protocol 31, onchain 45, realtime 11, web 24, worker 22) |
| Operasyon testleri | 28 PASS |
| V2 gerçek workerd/SQLite/WS | 12 kontrol PASS; debit ve settlement hata enjeksiyonu, cutoff, restart, idempotency, 4 havuz, audit ve expiry |
| Önceki V1 gerçek state/router | 13 + 12 kontrol PASS |
| Üretim Cloudflare bundle tarayıcıları | 50/50 PASS; skip/flaky/failure yok, 62,99 saniye |
| GLB/lisans/rig | 5 PASS |
| Gerçek iskelet/replay/temizlik | 4 PASS |
| TypeSafe çevrim dışı adaptör | 16 PASS; sağlayıcı testi değildir |
| Connectome araçları | İzole PyArrow ortamında 23/23 PASS; düz Python'da 17 PASS ve 6 açık optional skip |
| Yerel Metal render | 1,297 sn ilk hazır; 12 sn replay örneğinde 30,05 FPS, median 33,4 ms, p95 33,9 ms |
| GPU lifecycle | 116/116 buffer silme; canvas 0; context loss cleanup. 40/35 texture ve 24/16 program explicit delete; tam GPU allocation sıfır iddiası yok |
| Public build credential kontrolü | Mevcut üç özel credential değeri 49 public dosyada karşılaştırıldı, eşleşme 0; genel secret audit değildir |

300 deterministik simülasyonda mirrored-fighter/pozisyon/stamina/olay invariants ve 500 adversarial havuz örneği testlerin içindedir. Bunlar canlı yük veya öğrenme performansı ölçümü değildir. Binlerce eşzamanlı v2 oyuncu testi yapılmadı; pilot sınır 256 socket/256 bilet.

## Gerçek hosted kontrol

Cloudflare'da iki bağımsız tarayıcı oturumu, aynı maç #1 içinde altı bilet kabul etti; toplam 60 DEMO. Maç sonucu ve bitiş şekli havuzları ödendi, diğer iki tek taraflı havuz iade edildi. Başlangıç toplamı 2.000 DEMO = final oyuncu bakiyeleri 1.999,20 + platform kesintisi 0,80. Her havuzun dağıtım + kesinti toplamı stake toplamına eşitti. Seed/taahhüt, ortak maç sonucu, altı kayıtlı public audit, tam ekran, mobil taşma kontrolü, canlı GLB/credits hash'leri ve build ID doğrulandı; page error 0.

- Web build: `oqLqVSjR_8Zo-U4sTf3dC`.
- Web version: `302f65e6-411e-41fc-8d20-6c12f1db06f0` (%100).
- Realtime version: `514ed724-0995-486b-84ce-1355d11faf8f` (%100).
- Cloudflare MCP üzerinden aktif versiyonlar ve binding adları tekrar doğrulandı. Mevcut server secret binding'leri korundu; değerler rapora alınmadı.
- Kaynak testleri yerelde çalıştı; GitHub uzak CI çalıştı iddiası yok.

## Açık işler

Gerçek connectome kontrolcüsü, görev eğitimi/öğrenme değerlendirmesi, humanoid fizik/IK, tam dövüş tekniği seti, özel premium karakter/motion capture ve gerçek cihaz performans matrisi tamamlanmadı. Yeni pooled Solana kontratı ve bağımsız yürütme doğrulaması da bu demoda yoktur. Mevcut Coinflip/Crash çekirdek hazırlık denetimi 9 BLOCKED kapı ve productionApproved=false döndürür. Gerçek SOL, token launch, stake/airdrop açılışı bu yayınla yapılmadı.
