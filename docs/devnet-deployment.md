# Devnet deployment planı — yalnız okuma

[Planner](../scripts/devnet-deployment/plan.mjs), kendi House/Games/Incentives programları için artifact ve public kimlik eşleşmesini, pinli devnet genesis'i, finalized payer bakiyesini, program hesaplarının yokluğunu ve rent tekliflerini kontrol eder. Transaction oluşturmaz, imzalamaz veya göndermez; faucet çağrısı yapmaz. `status: BLOCKED` ve `productionApproved: false` kalır. Komut yalnız yeni bir yerel rapor üretir; deployment komutu değildir.

```bash
bash scripts/use-node.sh node --test scripts/devnet-deployment/plan.test.mjs
bash scripts/use-node.sh node scripts/devnet-deployment/plan.mjs \
  --programs house,games \
  --max-fee-per-transaction-lamports 100000 \
  --max-total-fees-lamports 10000000 \
  --payer-reserve-lamports 100000000
```

`house,games` ödülsüz canary kapsamını seçer. `--programs all` House→Incentives→Games sırasını seçer; sıralama hazırlık planıdır ve CPI/ödül özelliklerini etkinleştirmez. Ücretler için100.000lamport/işlem, toplam10.000.000lamport ve100.000.000lamport payer rezervi örnek planlama tavanlarıdır; güncel işlem ücreti teklifi, yeterlilik garantisi veya harcama izni değildir. RPC yalnız `https://api.devnet.solana.com` ve genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` içindir;600ms aralık ve429 sonrası durma uygulanır.

| Program | Beklenen public kimlik | Doğru program anahtarı |
| --- | --- | --- |
| House | `9bHnYHRGiNP8umiqtpAsALJYgcAJu3dKWVE1voGfqAu2` | `.tooling/keys/house-keypair.json` |
| Games | `8V4v7SqwVqx6aZUf2kFwJWdbSKBhqn5vdR4YeqZsfcQJ` | `.tooling/keys/games-keypair.json` |
| Incentives | `E5tr12oarJumShYmXvohnSDJNVKrVGuKS4gLm6pdgfHv` | `target/deploy/incentives-keypair.json` |

Payer `.tooling/per/probe-payer-keypair.json` → `2By6MdhFoXhCxdhQMPt15PLPJo8Q3Ge3pw1QAJ2J4waA`. Planner anahtar içeriğini yazdırmaz; regular0600 dosya ve `solana-keygen pubkey` eşleşmesi ister. **Varsayılan `anchor deploy` kullanılmamalıdır:** gözlemde `target/deploy/house-keypair.json` ve `games-keypair.json` otomatik anahtarları kaynak/IDL kimliklerinden farklıydı. Program kimliği anahtarı ve payer ayrı tutulur.

## 1 Ekim2026 19:27:48 UTC gözlemi

Kalıcı [salt okunur plan kanıtı](../ops/evidence/devnet-deployment-plan-20261001.json), SHA256 `d7fe8debfd661f07104676b1fa8779310ce1365d3437e275b2fee2bbbe23e4c4`. Payer finalized slot506379793, House/Games hesap yokluğu slot506379796. Bunlar o anki public RPC gözlemleridir; yeni bir deployment öncesi yeniden okunmalıdır.

| Kalem | Devnet SOL |
| --- | ---: |
| Payer bakiyesi | 0.457510728 |
| House kalıcı Program + ProgramData rent'i; ELF283.176byte | 1.440246040 |
| Games kalıcı Program + ProgramData rent'i; ELF372.464byte | 1.893829080 |
| Toplam kalıcı rent / başarılı sıralı CLI rent tepe ihtiyacı | 3.334075120 |
| Toplam10m fee tavanı +100m rezerv dahil plan | 3.444075120 |
| Yalnız kalıcı rent açığı | 2.876564392 |
| Fee tavanı ve rezerv dahil açık | 2.986564392 |

`maxLen` tam ELF boyudur; upgradeable-v3 Program hesabı36byte, Buffer metadata37byte, ProgramData metadata45byte. [Agave CLI4.1.2](https://github.com/anza-xyz/agave/blob/v4.1.2/cli/src/program.rs#L1371-L1385) yeni deploy'da dosya boyunu varsayar ve [buffer'ı ProgramData rent'i kadar fonlar](https://github.com/anza-xyz/agave/blob/v4.1.2/cli/src/program.rs#L2453-L2467): House1.439412920SOL, Games1.892995960SOL. [Loader final işlem içinde önce buffer'ı payer'a boşaltır, ardından ProgramData'yı oluşturur](https://github.com/anza-xyz/agave/blob/v4.1.2/programs/bpf_loader/src/lib.rs#L259-L273). Bu nedenle başarılı sıralı deploy'da buffer depozitosu ikinci kez eklenmez. Önceki `sequentialConservativeEnvelopeLamports` alanındaki5.337030440SOL ek buffer payı tutar; CLI'nin zorunlu ihtiyacı değildir.

Bu hesap yeni hesaplar, aynı payer, program başına tek buffer, bir deploy bitmeden diğerine başlamama, değişmeyen rent ve başarılı final işlem varsayar. Yarım kalan/tekrarlı buffer'lar, upgrade, daha büyük `maxLen`, oyun konfigürasyonu ve oyuncu hesapları, house bankroll'u, VRF/provider ücreti ve token ödül fonu dahil değildir.

## İnceleme sınırları ve CI

Salt okunur kullanımda somut bir işlem gönderme yolu bulunmadı. Manifest ile uyuşmayan ELF veya yanlış program kimliği reddedilir; buna rağmen **mevcut ELF ve kaynak hash'lerini birlikte kaydetmek, ELF'nin o kaynaktan yeniden derlendiğini kanıtlamaz**. Birbirini tutan eski ELF/manifest, yeni kaynakla birlikte kaydedilebilir. Planner derleyici/build provenance'ını, aktif cluster'ın SBPFv2 feature uyumluluğunu, ProgramData PDA'sını veya gelecekte kullanılacak buffer hesabını doğrulamaz. Gerçek deployment öncesi pinli temiz derleme/IDL kontrolü, dosya hash'leri, runtime feature doğrulaması ve hesap/ücret kontrolleri ayrıca gerekir. CLI feature/preflight kontrolleri atlanmamalıdır.

Rapor `wx` ile yeni dosyaya yazılır; araç eski raporun üzerine yazmaz. Bu, işletim sistemi düzeyinde değiştirilemezlik veya imzalı attestation değildir; daha sonraki tüketici haricen kaydedilmiş SHA256'yı doğrulamalıdır. RPC gözlemi de tek başına kriptografik consensus kanıtı değildir.

Planner'ın11 offline testi ve `scripts/check-managed-db.test.mjs` içindeki credential kullanmayan7 test, `pnpm test:operations` ile birlikte çalışır;18/18 yerelde geçti. `Verify/application` işine aynı komut eklendi; bu, GitHub'da çalışmış CI kanıtı değildir. CI'nin kurulu Node24'ü kullanılır; Mac/ARM'a özel `scripts/use-node.sh` Ubuntu x64 işinde çağrılmaz. Mevcut `Verify/database`, tüm migration'lar ve41 SQL assertion ardından concurrency testini çalıştırır. Gerçek managed DB kabul komutu ve canlı rent planner'ı normal PR testine bağlanmaz; bunlar kontrollü operatör çalıştırmasıdır.
