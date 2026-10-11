# Salt okunur devnet deployment planı

`plan.mjs` yalnız House, Games ve Incentives için public devnet RPC'den genesis, finalized payer bakiyesi, program hesabının yokluğu ve rent tekliflerini okur. Transaction oluşturmaz, imzalamaz, göndermez; faucet çağrısı veya anahtar üretimi yapmaz. RPC tek origin'e pinlidir, çağrılar en az600ms aralıklıdır;429 otomatik tekrarlanmaz.

```bash
bash scripts/use-node.sh node --test scripts/devnet-deployment/plan.test.mjs
bash scripts/use-node.sh node scripts/devnet-deployment/plan.mjs \
  --programs house,games \
  --max-fee-per-transaction-lamports 100000 \
  --max-total-fees-lamports 10000000 \
  --payer-reserve-lamports 100000000
```

`--programs house,games` yalnız ödülsüz canary planıdır; `--programs all` (varsayılan) House→Incentives→Games sırasını seçer. Başka eksik/tekrarlı/fixture program seçimi reddedilir. Bu kapsam seçimleri sözleşmeleri veya frontend özelliklerini etkinleştirmez.

Bu örnek ücret tavanları yalnız planlama girdisidir; harcama izni veya ücret tahmini değildir. Üç sayısal parametre de zorunludur. Rent, `maxLen` tam ELF boyuna eşit olacak şekilde upgradeable-v3 layout'u üzerinden hesaplanır. [Pinli CLI4.1.2](https://github.com/anza-xyz/agave/blob/v4.1.2/cli/src/program.rs#L1371-L1385) varsayılanı da mevcut dosya boyudur. CLI yeni buffer hesabına Buffer-minimum-rent yerine [ProgramData rent'i kadar yatırır](https://github.com/anza-xyz/agave/blob/v4.1.2/cli/src/program.rs#L2453-L2467). Final deployment içinde loader, [buffer'ı payer'a boşaltıp ardından ProgramData'yı oluşturur](https://github.com/anza-xyz/agave/blob/v4.1.2/programs/bpf_loader/src/lib.rs#L259-L273); bu depozito ayrıca ikinci kez gerekmez.

`cliSequentialRentPeakLamports` başarılı, yeni ve sırayla tamamlanan deployment'larda kalıcı rent toplamına eşittir. `cliStages` geçici CLI buffer depozitosunu ayrı gösterir; `cliSequentialEnvelopeWithLimitsLamports` toplam ücret tavanı ve payer rezervini de ekler. Eski `sequentialConservativeEnvelopeLamports` / `allBuffersConservativeEnvelopeLamports` alanları ayrıca minimum buffer rent'i tutan kasıtlı fazla paydır, CLI zorunluluğu değildir. Bu yorum aynı payer, tek buffer, değişmeyen rent ve deploy'u bitirmeden sonraki programa başlamama varsayar. Upgrade, fazla `maxLen`, yarım kalan/tekrarlı buffer, bankroll, oyun/oyuncu hesapları, token ve oracle ücretleri kapsam dışıdır.

Doğru program anahtarları açıkça `.tooling/keys/house-keypair.json`, `.tooling/keys/games-keypair.json`, `target/deploy/incentives-keypair.json` olarak seçilir. Payer `.tooling/per/probe-payer-keypair.json` için beklenen public kimlik `2By6MdhFoXhCxdhQMPt15PLPJo8Q3Ge3pw1QAJ2J4waA`'dır. Anahtar içeriği çıktıya yazılmaz; regular0600 dosya ve `solana-keygen pubkey` eşleşmesi aranır. Otomatik `target/deploy` House/Games anahtarları farklı olabileceğinden varsayılan `anchor deploy` kullanılmamalıdır.

Her başarılı gözlem `.tooling/contracts-deployment/plan-<UTC>.json` içinde `wx` ile yeni bir dosya oluşturur; aynı dosyanın üzerine yazılmaz ve stdout'ta SHA256 verilir. Rapor genesis, fee limits, IDL/ELF hash'leri ve kaynak/Cargo girdi snapshot'ını bağlar. Kaynak ile binary arasında taze reproducible build kanıtlamaz; `status:BLOCKED` ve `productionApproved:false` kalır. Daha sonraki gerçek deployment bu planı izin belgesi sayamaz: artifact/plan hash'leri, genesis, bakiye, rent, loader/maxLen ve anahtar kimlikleri yeniden doğrulanmalıdır.

Mevcut PER planner'ın yalnız `LOADER_BYTES` ve checked rent matematiği kullanılır; PER evidence/probe dosyaları değiştirilmez. On bir yerel test sentetik ELF/RPC fixture'larıyla doğru anahtar/scope/dependency sırası, buffer reuse hesabı, kimlik/hash uyuşmazlığı, yanlış genesis, eksik/bozuk gözlem, RPC allowlist/pacing, bütçe taşması ve immutable raporu sınar.
