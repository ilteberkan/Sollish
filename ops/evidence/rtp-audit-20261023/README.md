# RTP denetimi — 23–26 Ekim 2026

Kapsam: 7 oyun, 33 mod (Candy Cascade, Tarhun, Ebru, Cezeri, Asena, Göreme: standard / ante / buy; Damla: 15 risk-teras modu).
Yalnızca DEMO kredisi. Bu bir Monte Carlo denetimidir, sertifika değildir.

## Sade özet (sahip için)

- **Para yolu kusursuz.** 33 modun hepsinde, oyuncunun gerçek kod yolunda (yerel tur kaynağı → oyunun maliyeti → DEMO defteri → oturum)
  her turda defterin yatırdığı para motorun ödemesine **kuruşu kuruşuna** eşit; toplam bakiye değişimi = toplam kazanç − toplam bahis.
  Defter hiçbir turu reddetmedi ya da kırpmadı (kap sınırı her bahis basamağında motorun en büyük ödemesini karşılıyor).
- **RTP iddiaları tutuyor, iki istatistiksel uyarı var.** Önceden belirlenen ölçüte göre (iddia edilen RTP yeni 2 M turluk %95 aralığın içinde mi)
  33 moddan 31'i GEÇTİ, 2'si KALDI (Asena standard, Damla low-12). Oyuncu yolu ölçümünde (200 bin tur) 3 mod daha beklenen değerin
  %95 aralığının dışında kaldı (Cezeri buy, Göreme standard, Damla high-10). 38 bağımsız aralık testinde bunlar ~2 sigma sapmalar;
  %5 hata payıyla tesadüfen ~2 tane beklenir.
- **Hiçbir şey ayarlanmadı.** Motor, tablo ve iddia değerleri değişmedi. Kalan modlar için **yeni, daha önce hiç kullanılmamış tohumlarla ve 10 kat
  daha fazla turla** doğrulama yapıldı; hepsi iddiayla uyumlu çıktı (aşağıda). Doğrulama turlarından birinde (Göreme buy, 1 M oyuncu yolu)
  yeni bir aralık dışı sonuç görüldü; 20 M turluk çalıştırma onu da iddiayla uyumlu buldu. İlk KALDI sonuçları tabloda olduğu gibi duruyor.

## Tablo

"İddia edilen RTP": orijinal kanıt dosyası (`ops/evidence/<oyun>/rtp.json`) — Damla'da kesin binom değeri.
"Eski aralıkta mı": yeni tahmin orijinalin %95 aralığında mı. Orijinal 10–50 kat fazla tur kullandığı için aralığı çok dardır; 2 M turluk
bir tahminin bu dar aralığa düşmemesi **hata değildir** (aynı RTP'de bile ~%55 olasılıkla olur). Doğru karşılaştırma z değeridir
(iki tahminin farkı / birleşik standart hata); |z| < 1,96 uyumlu demektir.
"Oyuncu yolu RTP": bahis ağırlıklı = Σ ödeme / Σ maliyet (bakiyenin gördüğü); tur başı = her turun ödeme/maliyet ortalaması.
"Karar": KALDI = iddia yeni aralığın dışında, ya da defter motordan farklı, ya da oyuncu yolu RTP'si beklenenin %95 aralığının dışında.

| Oyun | Mod | İddia edilen RTP | Yeniden ölçülen RTP (2 M tur) | %95 aralık | Eski aralıkta mı | Oyuncu yolu RTP, 200 bin tur (bahis ağırlıklı / tur başı) | Defter = motor | Karar |
|---|---|---|---|---|---|---|---|---|
| Candy Cascade | standard | %95,74 | %97,36 | %95,34 – %99,38 | hayır (z=1,51) | %104,02 / %98,83 | evet | GEÇTİ |
| Candy Cascade | ante | %96,28 | %95,15 | %93,42 – %96,89 | hayır (z=-1,21) | %93,03 / %92,01 | evet | GEÇTİ |
| Candy Cascade | buy | %96,18 | %96,17 | %95,99 – %96,35 | evet (z=-0,14) | %96,20 / %96,17 | evet | GEÇTİ |
| Tarhun | standard | %96,47 | %96,02 | %94,30 – %97,75 | evet (z=-0,48) | %92,89 / %95,41 | evet | GEÇTİ |
| Tarhun | ante | %96,65 | %97,77 | %96,05 – %99,48 | hayır (z=1,23) | %99,61 / %98,56 | evet | GEÇTİ |
| Tarhun | buy | %96,23 | %96,21 | %96,02 – %96,40 | evet (z=-0,15) | %96,24 / %96,02 | evet | GEÇTİ |
| Ebru | standard | %95,69 | %94,47 | %91,72 – %97,21 | hayır (z=-0,82) | %102,45 / %106,15 | evet | GEÇTİ |
| Ebru | ante | %95,03 | %93,82 | %91,21 – %96,42 | hayır (z=-0,87) | %103,87 / %99,85 | evet | GEÇTİ |
| Ebru | buy | %95,38 | %95,14 | %94,83 – %95,46 | hayır (z=-1,38) | %94,61 / %94,97 | evet | GEÇTİ |
| Cezeri | standard | %95,55 | %94,45 | %92,79 – %96,10 | hayır (z=-1,24) | %95,39 / %97,62 | evet | GEÇTİ |
| Cezeri | ante | %95,35 | %95,98 | %94,39 – %97,58 | hayır (z=0,75) | %97,92 / %95,94 | evet | GEÇTİ |
| Cezeri | buy | %95,74 | %95,68 | %95,52 – %95,84 | hayır (z=-0,70) | %96,43 / %96,38 **(aralık dışı, z=2,25)** | evet | **KALDI** |
| Asena | standard | %95,15 | %92,33 | %89,60 – %95,06 | hayır (z=-1,92) | %90,54 / %92,19 | evet | **KALDI** |
| Asena | ante | %94,26 | %94,24 | %91,61 – %96,87 | evet (z=-0,02) | %96,24 / %89,57 | evet | GEÇTİ |
| Asena | buy | %95,84 | %95,82 | %95,46 – %96,17 | evet (z=-0,10) | %96,54 / %95,78 | evet | GEÇTİ |
| Göreme | standard | %96,30 | %96,55 | %92,94 – %100,16 | evet (z=0,14) | %85,95 / %92,13 **(aralık dışı, z=-2,08)** | evet | **KALDI** |
| Göreme | ante | %95,42 | %95,04 | %91,69 – %98,39 | evet (z=-0,22) | %87,58 / %90,76 | evet | GEÇTİ |
| Göreme | buy | %95,86 | %96,38 | %95,80 – %96,97 | hayır (z=1,68) | %96,30 / %96,46 | evet | GEÇTİ |
| Damla | low-8 | %98,516 (kesin) | %98,58 | %98,48 – %98,69 | hayır (z=1,27) | %98,13 / %98,32 | evet | GEÇTİ |
| Damla | low-10 | %98,486 (kesin) | %98,53 | %98,41 – %98,64 | hayır (z=0,69) | %98,33 / %98,41 | evet | GEÇTİ |
| Damla | low-12 | %98,551 (kesin) | %98,68 | %98,56 – %98,79 | hayır (z=2,11) | %98,39 / %98,64 | evet | **KALDI** |
| Damla | low-14 | %98,554 (kesin) | %98,46 | %98,34 – %98,58 | hayır (z=-1,52) | %98,28 / %98,80 | evet | GEÇTİ |
| Damla | low-16 | %98,545 (kesin) | %98,59 | %98,46 – %98,71 | hayır (z=0,65) | %98,19 / %98,85 | evet | GEÇTİ |
| Damla | medium-8 | %98,484 (kesin) | %98,51 | %98,30 – %98,73 | evet (z=0,26) | %98,04 / %98,05 | evet | GEÇTİ |
| Damla | medium-10 | %98,516 (kesin) | %98,59 | %98,35 – %98,84 | evet (z=0,63) | %98,67 / %98,69 | evet | GEÇTİ |
| Damla | medium-12 | %98,447 (kesin) | %98,39 | %98,13 – %98,65 | evet (z=-0,44) | %98,35 / %98,37 | evet | GEÇTİ |
| Damla | medium-14 | %98,499 (kesin) | %98,37 | %98,07 – %98,67 | hayır (z=-0,85) | %99,57 / %99,10 | evet | GEÇTİ |
| Damla | medium-16 | %98,512 (kesin) | %98,40 | %98,03 – %98,77 | evet (z=-0,60) | %99,07 / %97,96 | evet | GEÇTİ |
| Damla | high-8 | %98,500 (kesin) | %98,55 | %98,18 – %98,92 | evet (z=0,24) | %98,29 / %98,21 | evet | GEÇTİ |
| Damla | high-10 | %98,457 (kesin) | %98,39 | %97,90 – %98,88 | evet (z=-0,27) | %101,60 / %99,83 **(aralık dışı, z=2,18)** | evet | **KALDI** |
| Damla | high-12 | %98,453 (kesin) | %98,59 | %97,94 – %99,24 | evet (z=0,42) | %97,36 / %98,02 | evet | GEÇTİ |
| Damla | high-14 | %98,488 (kesin) | %98,75 | %97,83 – %99,66 | evet (z=0,55) | %98,14 / %98,71 | evet | GEÇTİ |
| Damla | high-16 | %98,491 (kesin) | %98,48 | %97,15 – %99,81 | evet (z=-0,02) | %99,23 / %104,10 | evet | GEÇTİ |

## Doğrulama turları (yeni tohum ad alanı, ilk kararlar değiştirilmedi)

| Oyun | Mod | Neden | Tur | Ölçülen RTP | %95 aralık | İddia | Sonuç |
|---|---|---|---|---|---|---|---|
| Asena | standard | yeniden simülasyonda KALDI | 20 M | %94,92 | %93,99 – %95,85 | %95,15 | uyumlu (z=−0,34) |
| Damla | low-12 | yeniden simülasyonda KALDI | 20 M | %98,578 | %98,541 – %98,615 | %98,551 (kesin) | uyumlu (z=1,44) |
| Cezeri | buy | oyuncu yolunda aralık dışı | 1 M (oyuncu yolu) | %95,74 | %95,46 – %96,02 | %95,7 | uyumlu (z=0,28) |
| Göreme | standard | oyuncu yolunda aralık dışı | 1 M (oyuncu yolu) | %95,56 | %87,38 – %103,74 | %96,3 | uyumlu (z=−0,18) |
| Damla | high-10 | oyuncu yolunda aralık dışı | 1 M (oyuncu yolu) | %98,42 | %97,21 – %99,62 | %98,457 (kesin) | uyumlu (z=−0,06) |
| Göreme | buy | 1 M oyuncu yolu doğrulamasında aralık dışı (%94,74, z=−2,35) | 20 M | %95,83 | %95,65 – %96,02 | %95,86 | uyumlu (z=−0,18) |

1 M oyuncu yolu doğrulamaları oyunun tüm modlarını oynar (`player-path-confirm-<oyun>.json`); defter = motor her modda yine tam tuttu.

## Yöntem

**(a) Bağımsız yeniden simülasyon** — `ops/rtp-audit/resim.ts`, `resim.json`, `resim.log`, mod başı `resim-parts/`.
- Motor: kamuya açık kayıt `SLOT_GAMES[oyun].play/cost` (RGS sunucusu ve tarayıcının çalıştırdığı fonksiyonlar). Orijinal koşular motorların
  iç test girişini (`__<oyun>Test.play`) ve xoshiro akışlarını kullanmıştı.
- Tohum: RGS'nin kanıtlanabilir adil kuralı (`slot-fair.ts deriveSeedHex`): serverSeed = sha256("sollish-rtp-audit-20261023/resim/<oyun>/<mod>"),
  clientSeed = "rtp-audit-20261023", seedHex = HMAC-SHA256(serverSeed, "clientSeed:nonce")[0..16], nonce 0..N−1. Her koşudan önce senkron
  türev, `deriveSeedHex` ile karşılaştırıldı. Bu ad alanı hiçbir kanıt koşusunda kullanılmadı. Toplamlar BigInt ile tam; sonuç işçi sayısından bağımsız.
- Mod başı 2 000 000 tur (Damla'nın 15 modu dahil), bahis 100 sent, RTP = Σ payoutCents / Σ costCents; standart sapma, %95 aralık (normal yaklaşım),
  isabet sıklığı, en büyük kazanç (tohumuyla), kap isabetleri, maliyet uyuşmazlığı (0).
- Komut: `bash scripts/use-node.sh node --import tsx ops/rtp-audit/resim.ts --rounds 2000000 --workers 2 --out ops/evidence/rtp-audit-20261023/resim.json`
- Doğrulama: aynı betik `--namespace sollish-rtp-audit-20261023/confirm --rounds 20000000 --games <oyun> --modes <mod>` (`confirm-*.json`, `confirm.log`).

**(b) Oyuncu yolu** — `apps/web/tests/rtp-player-path.test.ts`, `player-path.json`, `player-path.log`.
- Her tur: `createLocalSource(slotEnginesOf(<OYUN>_ENGINE)).resolve` → `<oyun>Cost` → `DemoLedger.reserve(maliyet, id, <oyun>LedgerLimits)` →
  `DemoLedger.settle({ payout: round.payoutCents })` → `recordSessionRound`. Her 97. turda tohum yeniden oynatılıp aynı tur alındığı doğrulandı.
- Bahisler gerçek basamaklardan döngüyle: 1000 DEMO başlangıç bakiyesinin karşılayabildiği tüm basamaklar (standard/ante/Damla: 19 basamak;
  buy: 7 basamak, 100–1500 sent). Bakiye yetmeyince defterin kendi "Bakiyeyi yenile"si kullanıldı (`resets`).
- Entropi deterministik: sha256("sollish-rtp-audit-20261023/player/<oyun>/<mod>/<i>") → tarayıcının crypto.getRandomValues ile doldurduğu aynı kanca.
- Komut (apps/web içinden): `RTP_PLAYER_PATH_ROUNDS=200000 RTP_PLAYER_PATH_OUT=../../ops/evidence/rtp-audit-20261023/player-path.json bash ../../scripts/use-node.sh npx tsx --test tests/rtp-player-path.test.ts`
  (CI'da varsayılan 300 tur/mod, ~2 sn). Sonuç: 8/8 test geçti; 33 modda ledgerMismatches = ledgerRefusals = costMismatches = replayMismatches = 0, sessionMatches = true.
- Kap: defter kırpmaz, aşımda reddeder (RangeError). Ayrı bir test her oyun/mod/basamakta motorun en büyük ödemesinin (kap × bahis; Damla'da
  modun en büyük havuzu) defter sınırına (maliyet × maxMultiplier) sığdığını gösteriyor.

**(c) Oturum istatistiği** — oyun içinde, oturum şeridindeki "Oturum istatistiği" düğmesi: tur sayısı, toplam bahis, toplam kazanç, oturum RTP'si,
beklenen RTP (oynanan modların maliyet ağırlıklı `SLOT_GAME_META.expectedRtp` ortalaması). Beklenen değerler orijinal kanıt dosyalarından
(3 haneye yuvarlanmış nokta tahmini; Damla'da kesin binom) alınır ve bir test bunu kanıt dosyalarına karşı denetler.

## Sınırlar

- Normal yaklaşımlı aralıklar ağır kuyruklu modlarda (standard/ante, kap 5000–10000×) iyimserdir; 2 M turda en büyük kazançlar birkaç kez görülür.
- Oyuncu yolunda bahis ağırlıklı RTP'nin etkin örnek sayısı tur sayısından küçüktür (büyük bahisler baskın).
- Yalnızca yerel DEMO yolu sınandı; uzak RGS (apps/realtime) bu denetimde koşturulmadı (aynı `SLOT_GAMES` motorunu kullanır).
- Oturum istatistiği paneli için birim test ve typecheck var; tarayıcıda görsel kabul yapılmadı.
- Barındırılan (hosted) ve mainnet kanıtı yok; GitHub CI çalıştırılmadı.
- Oyuncu yolu doğrulamasında bir an 3 tek-süreçli koşu birlikte çalıştı (2 süreç sınırı kısa süre aşıldı).
