# Enerji ve teknik seçimi: gerçek ödülle öğrenilen kontrolcü

3 Ekim 2026. **Enerji/çeşitlilik koşulları geçti; toplam kalite kapısı FAIL.** Model final testten sonra değiştirilmedi. Frozen canlı v3, biletler, ödeme yolu ve public manifest korunur. Yeni altı kayıt yalnız [deney preview klasöründedir](evidence/energy-cem-6/preview/manifest.json); yayın kararı ayrıdır.

## Teşhis ve yöntem

[Teşhiste](evidence/energy-controller-4/diagnostic.json) önceki guarded modelin32 gerçek maç/1.952 kararında1.026 düşük-stamina,158 anti-stall ve60 yaklaşma müdahalesi vardı. Ağ, guard davranışını öğrenmek yerine motorun zorunlu düzeltmesinden yararlanıyordu.

Yeni `energy-policy.mjs`, gerçek128 düğüm/4.949 kenarlı MaleCNS reservoir'ını ve önceki öğrenilmiş1.112 readout ağırlığını korur. Bunun üzerinde128 parametreli residual seçim katmanı eğitilir: enerji polinomları, gözlenebilir mesafe/hazırlık, kendi yakın **öneri** geçmişi ve önceki readout puanları. Bütün sekiz aksiyon sonlu puanla seçilebilir; legality mask veya düşük enerjide gizli otomatik guard yönlendirmesi yoktur. Ham öneri ve motorun uyguladığı eylem ayrı sayılır.

Öğrenme gerçek eylem→temas→hasar→maç ödülü döngüsünden gelir; öğretmen hamle etiketi yoktur. Ödüle çeşitlilik ve motor müdahalesi cezası açıkça eklendi. Sparse dinamik/duyusal eşleme varsayımsaldır; tam işlevsel beyin, bilinç veya öğrenilmiş eklem/tork/denge kontrolü iddiası değildir.

| Aşama | Gerçek eğitim maçı | Sonuç |
|---|---:|---|
| [Energy4](evidence/energy-controller-4/training.json) | 14.400 /60 nesil | Validation seçimi50: müdahale%10,62, teknik2,9375. Çeşitlilik FAIL; final açılmadı. |
| [Refinement5](evidence/energy-refinement-5/training.json) | 8.400 /35 nesil | Dört tekniğe kadar artan ödül; seçim20, teknik2,8889. Hook kullanılmadı; final açılmadı. |
| [CEM6](evidence/energy-cem-6/training.json) | 3.840 /20 nesil | Argmax düzlüğünü aşmak için yalnız16 saldırı bias/history/gain koordinatında çapraz entropi araması; kalan öğrenilmiş ağırlıklar sabit. Validation seçimi14. |

İlk iki aşamada antithetic Gaussian ES, son aşamada elit aday dağılımını güncelleyen CEM kullanıldı. Üç aşama toplam **26.640 eğitim maçı /534,87sn**; validation/final/audit bu sayıya dahil değildir. Node24.21.0/AppleM2, en yüksek RSS250.658.816byte (~239MiB). Paylaşılan geliştirme makinesindeki CPU ölçümüdür; VPS/mobil latency veya SLA değildir. Yeni GPU, ücretli servis veya ağ işlemi yoktur.

## Dondurulmuş final

[Plan](energy-cem-plan.json) train/validation/final için önceki koşulardan farklı alanlar kullanır. Model/eşik seçimi bittikten sonra **24 yeni seed ×2 taraf ×12 rakip =576 maç/politika** bir kez değerlendirildi. Dört yeni rakip enerji/tempo/baskı scriptidir; eğitimde kullanılmadı. Son testten sonra ayar yapılmadı. Sayısal kapılar `guarded-plan.json` ile aynı; eski random/curriculum baseline'ları değiştirilmedi. Aşağıdaki pratik karşılaştırma ayrıca **önceki guarded** modelle aynı yeni ortam/seed/rakiplerde yapılır.

| Ölçüm | Önceki guarded | Yeni kontrolcü |
|---|---:|---:|
| Kazanma | %91,319 | %90,799 |
| Beraberlik | %0 | %0,174 |
| Motorun değiştirdiği karar | %62,172 | **%8,606** |
| Maliyeti karşılanamayan ham saldırı /tüm kararlar, maç ortalaması | %28,299 | **%0,0028** |
| En az iki kez kullanılan saldırı tekniği/maç | 2,974 | **3,602** |
| Verilen/alınan hasar | 482,97 /265,12 | 383,09 /257,31 |
| Temiz isabet/maç | 14,983 | **10,880** |
| En uzun temassız süre | 8,55sn | 6,30sn |

[Final raporunda](evidence/energy-cem-6/evaluation.json) tek kalan eski kalite FAIL: **temiz isabet10,880 <12**. Diğer12 kontrol geçti. Enerji/çeşitlilik kazanımı daha fazla temiz isabete dönüşmedi; eşik düşürülmedi. Küçük scripted rakip bankası ve tek optimizer/curriculum dizisi genel insan becerisi dağılımını temsil etmez.

[Ham öneri auditi](evidence/energy-cem-6/single-action-audit.json):16.127 saldırı önerisinin16.126'sı maliyeti karşılar, biri karşılayamaz. Bu payda tüm kararlar üzerinden verilen maç ortalamasından farklıdır. 576 maçın24'ünde iki,181'inde üç,371'inde dört teknik en az ikişer kez kullanıldı. Rakip başına histogram ve affordable/unaffordable adetleri saklanır.

**Tek-tekme sömürüsü çözülmedi:** aynı bankada sürekli-kick baseline **%99,826**, öğrenci **%90,799** kazandı. Öğrencinin baskın saldırı payı ortalama%50,03, tek maçta en fazla%90,32. Ek ortalama≤%70 kontrolü geçti; her maçta dengeli çeşitlilik veya genel taktik üstünlük gösterilmedi. Sonraki ayrı mekanik sürümünde düşük saldırı savunması/tekme karşılığı ve temiz temas verimliliği araştırılmalı; bu final üzerinde ayar yapılmayacak.

## Kimlik ve doğrulama

Model SHA256: `eb270b099c4c0d64bebc55f1d74ee06e92c6d24335370f501011ee6c7a8f5dee`. Fizik `research:guarded-contact-1` olarak aynı kaldı. Üç paired seed/rakip finalden önce [seçildi](energy-preview-plan.json);6×901frame `research:energy-cem-6:` kayıt, exact byte/SHA ile sunulur. Önceki/yeni etiketi iki öğrenilmiş modeli karşılaştırır; baseline rastgele ağ değildir. [quality.json](evidence/energy-cem-6/preview/quality.json) UI için ham metrikleri taşır.

```sh
bash scripts/use-node.sh node --import tsx --test experiments/combat-selfplay/*.test.mjs
bash scripts/use-node.sh node experiments/combat-selfplay/export-energy-preview.mjs
```

**24 test PASS:** maskesiz seçim, yanlış öneri sayımı, eşik/partition ayrımı, kaynak/model/trace hashleri, kronolojik frame/hasar tutarlılığı, frozen motor parity ve gerçek küçük ES güncellemesi dahil. Bunlar kalite FAIL sonucunu değiştirmez. Tarihsel training runner'ları kendi çıktı klasörlerini yeniler; yeni araştırma için yeni çıktı/sürüm gerekir.

Bir paralel koşuda eski cache yazıcısı `env.simulate is not a function` üretti; tek başına aynı test geçti. Eski write→import yolu eşzamanlı okuyucuyu eksik dosyayla karşılaştırabiliyordu. İki loader artık tek `atomic-module.mjs` ile benzersiz geçici dosya→atomik rename→import kullanır. Dört ayrı süreç/toplam16 eşzamanlı derleme-import kontrolü geçti; generated engine/adapter hashleri değişmedi. Eğitimde kullanılan loader byte'ları [SHA adresli arşivde](evidence/source-archive/manifest.json) korunur; eski raporlar geriye dönük yeniden yazılmadı. Bu dosya-yayını düzeltmesi model veya final sonuçlarını değiştirmez.

## Lab yayın kaydı — aynı gün

Yukarıdaki deney sınırı tamamlandıktan sonra altı karşılaştırma kaydı ve açık kalite sonuçları yalnız `/lab/ringside` araştırma ekranında yayımlandı. Frozen LIVE politika, maç ve ekonomi değiştirilmedi. Yayın, build, dosya hashleri ve hosted kontrolleri [ayrı sürüm kanıtında](../../ops/evidence/ringside-quality-20261003.json) bulunur. Bu yayın kalite kapısının geçildiği veya modelin canlı oyuna terfi ettiği anlamına gelmez.
