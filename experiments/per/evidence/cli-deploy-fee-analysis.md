# Kendi probe deploy bütçesi: 1 Ekim 2026

**2 test SOL, 292.384 byte kendi probe programının ilk başarılı deploy'u için yeterli.** Saat 14:06:43 UTC devnet ölçümünde seçilen CLI seçenekleriyle kalıcı rent ve bir başarılı geçişin işlem ücretleri toplamı **1,488567680 SOL**; kalan **0,511432320 SOL**. Bu, PER/TEE kabulü veya sonraki deney masraflarının garantisi değildir. Makine tarafından okunabilir ölçümler [ayrı JSON kaydında](cli-deploy-fee-analysis-2026-10-01.json).

Önceki 2,973171600 SOL hesabı geçici buffer ile kalıcı ProgramData rent'ini birlikte tutan muhafazakâr bir zarf. Kullanılan Agave 4.1.2 kaynak commit'i `182084b82aae88b1b0731540f63bf7416f27773a`: loader, buffer lamportlarını önce payer'a aktarır ve ardından ProgramData'yı finanse eder. CLI buffer'a ProgramData rent'ini yatırır; balance ön kontrolü bu tutarı yalnız bir kez sayar. Ayrı Program rent'ini ön kontrol atlar; buradaki hesap onu da ekler. [Loader](https://github.com/anza-xyz/agave/blob/182084b82aae88b1b0731540f63bf7416f27773a/programs/bpf_loader/src/lib.rs#L279-L302), [buffer finansmanı](https://github.com/anza-xyz/agave/blob/182084b82aae88b1b0731540f63bf7416f27773a/cli/src/program.rs#L2556-L2569), [CLI ücret kontrolü](https://github.com/anza-xyz/agave/blob/182084b82aae88b1b0731540f63bf7416f27773a/cli/src/program.rs#L3046-L3077).

| Kalem | Lamport |
| --- | ---: |
| Program, 36 byte | 833.120 |
| ProgramData, 292.429 byte | 1.486.189.560 |
| Başlangıç + final işlemi, ikişer imza | 20.000 |
| 305 write işlemi, birer imza | 1.525.000 |
| Toplam, ilk başarılı geçiş | **1.488.567.680** |

Hesap `--max-len 292384 --with-compute-unit-price 0 --max-sign-attempts 1 --use-rpc`, açık preflight, payer ile upgrade authority'nin aynı cüzdan olması ve ayrı program/buffer signer'ları içindir. Açık sıfır priority seçeneği compute-budget talimatlarını eklediği için write kapasitesi 960 byte ve gerçek binary için 305 parçadır; sıfır parça atlanmadı. `getFeeForMessage` üç mesaj türünde sırasıyla 10.000 / 5.000 / 10.000 lamport verdi. Bu seçenek için write yeniden imzalama döngüsü bir turdur. Yeniden gönderilen aynı imzalı işlem ikinci kez uygulanmaz; başarısız deploy'u elle devam ettirmek ayrı masraf olabilir. [Chunk hesabı](https://github.com/anza-xyz/agave/blob/182084b82aae88b1b0731540f63bf7416f27773a/cli/src/program.rs#L2521-L2531), [imzalama döngüsü](https://github.com/anza-xyz/agave/blob/182084b82aae88b1b0731540f63bf7416f27773a/client/src/send_and_confirm_transactions_in_parallel.rs#L489-L506).

Mevcut oyuncu A anahtarı yalnız simülasyonda buffer rolüne konarak imzaları doğrulanan başlangıç işlemi çalıştırıldı: `err:null`, 2.820 CU. Sonraki salt okuma, o hesabın hâlâ bulunmadığını ve gerçek payer bakiyesinin 2 SOL kaldığını doğruladı. Yeni anahtar veya hesap oluşturulmadı, işlem gönderilmedi. Bu test ELF upload/final deploy'u simüle etmez; `program deploy` komutunda bütün süreci kapsayan `--sign-only` seçeneği yoktur. İki oyuncunun fonlanması, izin/delegasyon rent'i, provider harçları ve deney çağrıları kalan bakiyeden ayrıca karşılanır.
