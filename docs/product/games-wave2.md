# Sollish oyun dalgası 2 — üç özgün oyun

Durum: 12 Ekim 2026, sahip kararı ("dünyada hiç üretilmemiş, kasa her zaman kazanır, viral"). `docs/product/game-standards.md` bütünüyle geçerlidir (özellikle §6). Her oyun: özgün ad, sanat, ses, ödeme tablosu; DEMO; tek motor kimliği; her mod için ≥20 M tur RTP kanıtı; **her modun RTP'si %94–96,5 arası (kasa avantajı ≥ %3,5)**; azami kazanç tavanı; tam sayı aritmetik; deterministik `play…Round(seedHex, betCents, mode)`; Candy Cascade v2 / Tarhun ile aynı tur şekli (`engine, seedHex, mode, betCents, costCents, spins[], totalHundredths, payoutCents, capped, freeSpinsTriggered`), adım listeleri sunumun her animasyonunu sürer. Modlar: `standard`, `ante` (×5/4, özellik ~2 kat sık), `buy` (×100; Asena ×80). Bahis basamakları Tarhun ile aynı.

Ortak yenilik (platform): **Paylaşılabilir tur tekrarı** — her tur deterministik olduğu için "Kazancını paylaş" bağlantısı turu bakiyeye dokunmadan herkese aynen oynatır (sunucu imzalı tur kaydı, bkz. `docs/architecture/slot-rgs.md`). Viral döngünün çekirdeği budur.

---

## 1. Cezeri: Zamanın Çarkları (`cezeri`, motor `cezeri-gears-1`)
**Tema:** 12. yüzyıl Artuklu mühendisi el-Cezerî'nin otomatları (fil saati, su saatleri, otomat müzisyenler). Pirinç dişliler, firuze çini, su, mekanik kuşlar. Tarih ve mühendislik; kamu malı. Görsel: el-Cezerî minyatür üslubundan esinlenen özgün çizim, gerçek bir eserin kopyası değil.

**Yeni mekanik: Eşmerkezli çarklar.** Tahta, merkezde bir **göbek** ve çevresinde 4 eşmerkezli **halka**dır; her halka 12 dilimlidir. 12 **ışın** göbekten dışa uzanır. Dönüşte her halka kendi dairesel şeridinde (uzunluk 30–48, mod başına ağırlıklı şerit) rastgele bir duruşa döner; görünen 12 dilim şeridin 12 ardışık konumudur.
- **Kazanç:** bir ışın üzerinde içten dışa aynı sembolden ardışık 3 veya 4 dilim; seri **halka 1'den (3 veya 4 dilim) ya da halka 2'den (3 dilim: halka 2-4)** başlayabilir. Bir ışında en iyi seri öder (eşitlikte halka 1). 12 ışın bağımsız öder. Joker `gear` (Altın Dişli) her normal sembolün yerine geçer; art arda 3–4 joker kendi ödeme tablosuyla öder.
- **Göbek çarpanı:** göbek her dönüşte ×1, ×2, ×3, ×5, ×10 değerlerinden birini gösterir (ağırlıklı); o dönüşün bütün ışın kazançlarını çarpar.
- **Kenetlenme (Dişli Kilidi) zinciri (nihai kural, motor `cezeri-gears-1`):** bir dönüşte yeni kazanç varsa kazanan serilerin **dilimleri kilitlenir** (olduğu gibi sabitlenir, simgesini korur, kıpırdamaz); **dört halkanın hepsi** altlarında yeniden döner (kilitli dilimler üstte kalır) ve göbek çarpanı her yeniden dönüşte **+1** artar. Zincir, yeniden dönüş **yeni bir ödeme** üretirse (yeni bir ışın ya da kilitli bir serinin uzaması, ör. 3 → 4 dilim) sürer; bir ışının yalnız önceki ödemesinin üzerindeki **fark** ödenir. Zincir yeni ödemesiz ilk yeniden dönüşte, 48 dilimin hepsi kilitlenince ya da en çok **10 yeniden dönüşte** biter (son dönüş yine ödenir). Kilitli dilimler dönüş bitince çözülür (şahin jokerleri bedava dönüşlerde kalıcıdır). Taban oyunda ilk dönüş jokersiz şeritlerde, yeniden dönüşler halka başına bir Altın Dişli içeren şeritlerde döner; bu, zincirin ortalama ~2 yeniden dönüşe uzamasını sağlar. Bedava dönüşte her dönüş aynı bedava şeritlerinde döner ve taşınan göbek çarpanı korunur. Bu, düşme (tumble) yerine **dönme zinciri**dir.
- **Scatter `vessel` (Su Kabı):** halkaların herhangi bir yerinde 3+ → 10 bedava dönüş (3: 2×, 4: 10×, 5+: 50× scatter ödemesi). Bedava dönüşte 2+ → +4.
- **Fil Saati özelliği (bedava dönüş):** her dönüşten sonra su haznesi bir kademe dolar; **göbek çarpanı sıfırlanmaz**, dönüşler arasında birikir (yalnız artar); her 3 dönüşte otomat şahin bir halkaya 1–3 Altın Dişli joker dilimi ekler (özellik sonuna kadar kalır).
- **Azami kazanç:** 10.000 × bahis.
- **Adımlar:** `hub` (göbek değeri), `rotate` (dört halkanın ofseti, kilitli/şahin dilimleri, tahta görüntüsü), `win` (ışın, başlangıç halkası, dilim konumları, sembol, uzunluk, fark ödemesi), `lock` (kilitli dilimler, yeniden dönüş var mı), `end` (zincir özeti), `scatter`, `falcon` (eklenen kalıcı joker dilimleri).

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

---

## Üretim kaydı: Türkçe seslendirme (16 Ekim 2026)
Kaynak metinler `apps/web/lib/slot-audio/{cezeri,ebru,asena}-tiers.ts` içindeki `*_VOICE_TEXT`; yazım "…" yerine "..." olarak gönderildi, geri kalanı aynen. Çıktı `apps/web/public/audio/voice/<oyun>/<satır>.mp3` (Storm klasörüne dokunulmadı).

- **Model:** Higgsfield `text2speech_v2`, varyant `elevenlabs`, hazır (preset) ses, `use_unlim: false`. Seslendirme yapay sestir; gerçek bir kişinin kaydı değildir.
- **Cezeri (22 satır):** Barrett (`d603a8cd-3fe1-55e0-9245-617a2589131e`), yaşlı, ölçülü erkek mühendis sesi.
- **Ses seçimi (Ebru ve Asena):** aynı cümle («Gök açıldı! Kurt yol gösteriyor...») ile üç aday denendi; medyan F0, 16 kHz mono otokorelasyon (30/50/60 ms pencere, aralık 60-400 Hz):

  | Aday | Medyan F0 |
  |---|---|
  | Elena | ~243-272 Hz |
  | Vesper | ~159-166 Hz |
  | Nora | ~151-152 Hz |

  En düşük perde **Nora → Asena (29 satır)**; bir sonraki **Vesper → Ebru (18 satır)**. Elena elendi. Vesper ile Nora arasındaki fark küçük (~8-10 Hz); seçim kural gereği F0 sırasına göre yapıldı, kulak kararı değildir.
- **Kredi:** 46,55 → 35,75 (10,80 kredi; 72 başarılı iş x 0,15: 69 satır + 3 deneme). 429 `rate_limit_reached` alan istekler yalnızca o kalem için, iş kimliği alınmadan yeniden gönderildi; iş kimliği alan hiçbir kalem tekrarlanmadı. Başarısız üretim yok.
- **İşleme (ffmpeg):** baş/son sessizlik kırpma (`silenceremove` -45 dB, 0,05 s / 0,12 s), `loudnorm=I=-16:TP=-1.5:LRA=7`, 44,1 kHz, mono, 128 kb/s MP3.
- **Doğrulama (ebur128):** 69 dosyanın tamamında gerçek tepe <= -1,8 dBTP (sınır -1,5). Bütünleşik gürültü 64 dosyada -16 LUFS civarında (en fazla 0,8 LU sapma), ancak 5 kısa ve tepe değerli kayıt tepe sınırı yüzünden hedefe ulaşamadı (iki geçişli loudnorm de aynı sonucu verdi): `cezeri/reservoir` -17,2, `cezeri/retrigger` -17,3, `asena/tpl-at` -17,6, `asena/tpl-kurt-basi` -18,0, `asena/sky-open` -19,0 LUFS. Dosya sayısı satır sayısına eşit: Cezeri 22, Ebru 18, Asena 29.
- **Durum:** sahibin dinleme kabulü bekleniyor. Kabul edilmeden ses seçimi (özellikle Ebru ve Asena) kesin sayılmaz; beğenilmezse yalnızca ilgili oyunun satırları yeniden üretilir (ek kredi gerekir).
