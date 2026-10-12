# Sollish oyun dalgası 2 — üç özgün oyun

Durum: 12 Ekim 2026, sahip kararı ("dünyada hiç üretilmemiş, kasa her zaman kazanır, viral"). `docs/product/game-standards.md` bütünüyle geçerlidir (özellikle §6). Her oyun: özgün ad, sanat, ses, ödeme tablosu; DEMO; tek motor kimliği; her mod için ≥20 M tur RTP kanıtı; **her modun RTP'si %94–96,5 arası (kasa avantajı ≥ %3,5)**; azami kazanç tavanı; tam sayı aritmetik; deterministik `play…Round(seedHex, betCents, mode)`; Candy Cascade v2 / Tarhun ile aynı tur şekli (`engine, seedHex, mode, betCents, costCents, spins[], totalHundredths, payoutCents, capped, freeSpinsTriggered`), adım listeleri sunumun her animasyonunu sürer. Modlar: `standard`, `ante` (×5/4, özellik ~2 kat sık), `buy` (×100; Asena ×80). Bahis basamakları Tarhun ile aynı.

Ortak yenilik (platform): **Paylaşılabilir tur tekrarı** — her tur deterministik olduğu için "Kazancını paylaş" bağlantısı turu bakiyeye dokunmadan herkese aynen oynatır (sunucu imzalı tur kaydı, bkz. `docs/architecture/slot-rgs.md`). Viral döngünün çekirdeği budur.

---

## 1. Cezeri: Zamanın Çarkları (`cezeri`, motor `cezeri-gears-1`)
**Tema:** 12. yüzyıl Artuklu mühendisi el-Cezerî'nin otomatları (fil saati, su saatleri, otomat müzisyenler). Pirinç dişliler, firuze çini, su, mekanik kuşlar. Tarih ve mühendislik; kamu malı. Görsel: el-Cezerî minyatür üslubundan esinlenen özgün çizim, gerçek bir eserin kopyası değil.

**Yeni mekanik: Eşmerkezli çarklar.** Tahta, merkezde bir **göbek** ve çevresinde 4 eşmerkezli **halka**dır; her halka 12 dilimlidir. 12 **ışın** göbekten dışa uzanır. Dönüşte her halka kendi dairesel şeridinde (uzunluk 30–48, mod başına ağırlıklı şerit) rastgele bir duruşa döner; görünen 12 dilim şeridin 12 ardışık konumudur.
- **Kazanç:** bir ışın üzerinde içten dışa (halka 1'den başlayarak) aynı sembolden ardışık 3 veya 4 dilim. 12 ışın bağımsız öder. Joker `gear` (Altın Dişli) her normal sembolün yerine geçer.
- **Göbek çarpanı:** göbek her dönüşte ×1, ×2, ×3, ×5, ×10 değerlerinden birini gösterir (ağırlıklı); o dönüşün bütün ışın kazançlarını çarpar.
- **Kenetlenme (Dişli Kilidi) zinciri:** bir dönüşte kazanç varsa, kazanç içeren halkalar kilitlenir, kazançsız halkalar yeniden döner ("Çark döndü"); her yeniden dönüşte göbek çarpanı +1 artar; yeni kazanç yoksa zincir biter. Bu, düşme (tumble) yerine **dönme zinciri**dir.
- **Scatter `vessel` (Su Kabı):** halkaların herhangi bir yerinde 3+ → 10 bedava dönüş (3: 2×, 4: 10×, 5+: 50× scatter ödemesi). Bedava dönüşte 2+ → +4.
- **Fil Saati özelliği (bedava dönüş):** her dönüşten sonra su haznesi bir kademe dolar; **göbek çarpanı sıfırlanmaz**, dönüşler arasında birikir (yalnız artar); her 3 dönüşte otomat şahin bir halkaya 1–3 Altın Dişli joker dilimi ekler (özellik sonuna kadar kalır).
- **Azami kazanç:** 10.000 × bahis.
- **Adımlar:** `rotate` (halka id → ofset), `win` (ışın, dilim konumları, sembol, uzunluk, ödeme), `lock` (kilitli halkalar), `hub` (göbek değeri), `falcon` (eklenen joker dilimleri), `scatter`.

## 2. Ebru: Mürekkep Bahçesi (`ebru`, motor `ebru-ink-1`)
**Tema:** Türk ebru sanatı — su üstünde boya, tarak, lale, karanfil, hatip ebrusu. Bütünüyle sıvı, büyüleyici, "izlemesi tatmin edici" (ASMR) görseller: viral potansiyel en yüksek oyun.

**Yeni mekanik: Tarak dönüşümü.** 7×7 ızgara, **küme ödemesi** (yatay/dikey komşu 5+ aynı renk mürekkep damlası).
- Kazanan kümeler suya dağılır, kalanlar düşer, boşluklar dolar (tumble).
- **Tarak geçişi:** her düşme adımından sonra, yeni kazanç yoksa bile bir kez, bir **tarak** tahtayı tarar: satır r, `round(A · sin(φ + r · k))` kadar dairesel kaydırılır (A, φ, k her geçişte RNG'den; A ∈ {1,2,3}). Tarak semboller arasında yeni kümeler oluşturabilir; oluşursa zincir sürer. En çok 3 tarak geçişi / dönüş.
- **Damla joker `drop`:** düştüğü yerde dairesel "mürekkep yayılması" yapar: komşu 4 hücreyi, komşuları arasında en sık görülen renge boyar (eşitlikte RNG), sonra kendisi o renk olur.
- **Scatter `comb` (Altın Tarak):** 3+ → 8 bedava dönüş (3: 3×, 4: 10×, 5+: 100×); bedava dönüşte 3+ → +4.
- **Lale Ebrusu özelliği:** bir kümenin patladığı her hücreye **boya lekesi çarpanı** düşer (ilk ×2, aynı hücrede tekrarlarda ikiye katlanır, en çok ×256). Lekeler özellik boyunca kalır ve **tarak geçişiyle birlikte kayar** (çarpan alanı da taranır — dünyada ilk). Bir küme lekeli hücrelerden geçerse, küme ödemesi o hücrelerdeki çarpanların **toplamı** ile çarpılır.
- **Azami kazanç:** 10.000 × bahis.
- **Adımlar:** `drop-in`, `clusters` (hücreler, renk, boyut, ödeme), `burst`, `fall`, `comb` (A, φ, k, satır kaymaları), `bleed` (joker yayılması), `stains` (leke alanı).

## 3. Asena: Yıldız Kurdu (`asena`, motor `asena-stars-1`)
**Tema:** Türk gök mitolojisi — Gök Tengri, Ay Ata, Kün Ana, yol gösteren gök kurt Asena ve Ergenekon'dan çıkış efsanesi. Bozkır gecesi, kutup ışıkları, yıldız tozu, kurt uluması. Kamu malı mitoloji; karakter ve çizim özgün.

**Yeni mekanik: Takımyıldız şekilleri.** 6×6 yıldız alanı, **küme ödemesi** (komşu 5+), tumble.
- **Şekil ödemesi:** göğün çerçevesinde 6 takımyıldız şablonu vardır (Kurt Başı, Yay, At, Kartal, Hayat Ağacı, Hilal; her biri 5–7 hücrelik özgün şekil). Kazanan bir küme, bir şablonu (döndürme/yansıtma dahil) **içeriyorsa** takımyıldız tutuşur: küme ödemesi şablona özgü çarpanla (×2–×10) çarpılır ve o takımyıldız "yanar".
- **Kurt joker `wolf`:** her normal sembolün yerine geçer. Bir kazanca katılırsa **yürür**: her düşme adımında bir hücre ilerler (RNG yönü, tahtada kalır) ve geçtiği hücreyi **yıldız izi jokeri**ne çevirir (o dönüş sonuna kadar).
- **Scatter `moon` (Ay Ata):** 3+ → 10 bedava dönüş (3: 3×, 4: 8×, 5+: 60×); bedava dönüşte 3+ → +3.
- **Ergenekon özelliği:** yanan her takımyıldız Ergenekon haritasının bir parçasını açar. 3 farklı takımyıldız → +5 dönüş ve **genel çarpan ×2**; 6 farklı → +5 ve ×3; hepsi iki kez → ×5 (genel çarpan özellik boyunca kalır, her kazancı çarpar).
- **Azami kazanç:** 5.000 × bahis.
- **Adımlar:** `drop-in`, `clusters`, `constellation` (şablon, dönüşüm, hücreler, çarpan), `wolf-walk` (yol, iz hücreleri), `burst`, `fall`, `map` (açılan parçalar, genel çarpan).

---

## Ortak sunum hedefleri
- Her oyunun **imza anı** (viral klip): Cezeri — çarkların kenetlenip dişli sesiyle dönmesi ve göbek çarpanının sayaç gibi atması; Ebru — tarağın suyu taraması ve mürekkebin dalga dalga yeniden dizilmesi; Asena — takımyıldızın gökte çizilip kurdun uluması.
- Animasyon uyumu: her adımın süresi zaman çizelgesinde tanımlı; ses vuruşları ve görsel darbeler aynı zaman damgasına bağlı (`lib/slot-kit/timeline-player.ts`).
- Kutlamalar, kilit, birikimli kazanç, sade otomatik oyun: §6.
