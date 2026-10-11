# İkinci deney: daha zor rakipler, değişmeyen kalite eşikleri

3 Ekim 2026. İlk [başarısız aday](README.md) korunmuştur. Bu ikinci koşuda ilk öğrenilmiş modelden başlanıp sürekli-cross, counter, gard, punisher, karma saldırı ve yeni öğrencinin geçmiş snapshot'ları karşısında gerçek episode ödülünden öğrenildi. Öğretmen etiketi yoktur. Frozen v3 motor/politika dosyaları değişmedi.

[Önkayıt](curriculum-plan.json) ve [koşu kaydı](evidence/curriculum-2/run-plan.json) yeni eğitim/doğrulama/final seed alanlarını ve eşikleri içerir. 40 nesil ×20 antithetic yön ×2 işaret ×6 maç = **9.600 eğitim maçı**. Ödüle saldırı entropisi, iki veya daha fazla kullanılan teknik sayısı ve motor override cezası açıkça eklendi; bunlar biyolojik motivasyon veya dışarıdan doğru hamle etiketi değildir. Bütün model/ödül seçimleri yeni final bölümüne bakılmadan donduruldu. Validation nesil15'i seçti.

Final **32 yeni seed ×2 taraf ×8 rakip =512 maç/politika**. Aynı koşullarda rastgele başlangıç, ilk öğrenilmiş model ve curriculum adayı değerlendirildi. Finalde v1 ve sürekli-cross bilinen rakipler; delayed-counter, combo, enerji/ipe göre davranan rakipler, sürekli-hook ve frozen-v3 farklı karşılaştırmalardır. Bunlar küçük scripted rakiplerdir; geniş insan becerisi dağılımı değildir.

| Ölçüm | İlk öğrenilmiş model | Curriculum adayı |
|---|---:|---:|
| Skor (kazanma1/beraberlik0,5) | 0,6055 | 0,8486 |
| Kazanma | %60,35 | %84,57 |
| Verilen/alınan ortalama hasar | 669,82 /618,32 | 681,50 /604,30 |
| Temiz isabet/maç | 20,38 | 21,14 |
| En az iki kez kullanılan saldırı tekniği/maç | 1,93 | 1,95 |
| Motor tarafından değiştirilen karar | %53,72 | %53,15 |
| Yetersiz stamina ile önerilen saldırı/maç | 7,48 | 7,78 |
| En uzun temassız süre | 6,35sn | 8,30sn |

Sonuç yine **FAIL**. Önceki win/damage/entropy/no-strike eşikleri ve v1'e karşı gelişim koşulları geçti; fakat **≥3 teknik, ≤%25 override ve ≤8sn temassız süre** koşulları geçmedi. Hiçbir eşik sonuçtan sonra düşürülmedi. Ortalama saldırı çeşitliliği hedefe ulaşmadı; curriculum yaklaşımı bu küçük koşuda öğrenilmiş savunma/enerji yönetimi üretmedi. Durumlarda ring/stamina sınırı ihlali0 olması motorun koruyucu kurallarını doğrular, politika bağımsız güvenliği değildir.

[Tam sonuç](evidence/curriculum-2/evaluation.json), eğitim checkpoint'leri ve ham bölüm ölçümleri saklanır. Eğitim173,69sn, tüm koşu211,67sn; Node24.21/AppleM2 yerel CPU. Yeni model yalnız araştırma adayıdır; gerçek varlık/deployment kapısı **CLOSED**.

```sh
bash scripts/use-node.sh node --import tsx --test experiments/combat-selfplay/curriculum.test.mjs
bash scripts/use-node.sh node experiments/combat-selfplay/curriculum.mjs
bash scripts/use-node.sh node experiments/combat-selfplay/export-curriculum-preview.mjs
```

Önceki sonuçlar ikinci koşuyla değiştirilmez. Yeni preview kimlikleri `research:combat-selfplay-curriculum-2:` ile başlar ve finansal v3 protokolünde kabul edilmez. Gözlenen cross sömürüsünün sonraki mekanik teşhisi ayrı bir deneydir; bu koşunun motorunu, reward'unu veya sonuçlarını geriye dönük değiştirmez.
