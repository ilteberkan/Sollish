# Sollish tasarım brief’i

Durum: 1 Ekim 2026 araştırmasına dayanan tasarım yönü. Web arayüzü artık apps/web altında uygulanmıştır; yerel tarayıcı ve erişilebilirlik ölçümleri docs/validation.md dosyasında izlenir. Bu brief canlı finansal özelliklerin açıldığı anlamına gelmez.
Geliştirme sırası korunur: sözleşmeler ve güvenlik deneyleri, backend, ardından frontend.
Bu belge görsel kararları ve kabul hedeflerini kaydeder; TEE/VRF veya ödeme garantisi vermez.

## Ürün ve görsel yön

Sollish, Crash ve Coinflip için koyu temalı, mobil kullanılabilir bir oyun alanıdır.
Ana iş: bahis miktarını anlamak, turu izlemek, manuel çıkış yapmak ve gerçek sonucu görmek.
İlk açılış oyun ekranına götürür; token pazarlaması ve staking ayrı rotalarda kalır.

| Aday | Görsel yaklaşım | Değerlendirme |
| --- | --- | --- |
| A — Oyun masası | Geniş oyun sahnesi, sahneye bitişik kontrol şeridi, düzenli kayıt listesi, dar chat sütunu | Çalışma yönü olarak seçildi: manuel çıkışın yeri sabit; küçük ekrana sadeleşmesi kolay. |
| B — Gece yayını | Tam genişlikli hareketli sahne, daha büyük başlıklar, açılır bahis ve topluluk panelleri | Marka anlatımı güçlü; hareket ve açılır kontroller kritik eylemle yarışabilir. |

Ayırt edici öğe Sollish’e özel çizgi/iz biçimi ve yazı işaretidir; oyun verisini taklit eden süs çizilmez.
Crash’in büyük çarpanı karar verilecek gerçek bilgidir. Çevresindeki yüzeyler sakin tutulur.
Asit yeşili vurgular, dekoratif gradientler, eş boy kart duvarları veya krem/serif şablonu kullanılmaz.
Özgünlük, kullanılabilirliği bozacak yeni kontrol davranışları üretmek anlamına gelmez.

## Geçici tasarım token’ları

| Rol | Değer | Kullanım |
| --- | --- | --- |
| Zemin | `#10171F` | Sayfanın ana yüzeyi |
| Yüzey | `#1A2632` | Kontroller ve chat alanı |
| Ayırıcı | `#3D5265` | Grupları ayıran çizgiler; metin yerine kullanılmaz |
| Ana metin | `#F1F5F8` | Miktarlar ve temel içerik |
| İkincil metin | `#AEBFCB` | Yardımcı açıklamalar |
| Eylem | `#E9B35D` | Ana eylem; üzerinde koyu zemin rengiyle metin |

Renkler taslak değerlerdir; gerçek boyut, ağırlık ve durum kombinasyonlarında kontrast ölçülecek.
Başlangıç tipografisi tek aile **Barlow**: gövde 400, kontroller 500, miktar/başlık 600.
[Tasarımcının resmi deposu](https://github.com/jpt/barlow) ve [SIL OFL 1.1 lisansı](https://github.com/jpt/barlow/blob/main/OFL.txt) incelendi.
Font yerelden sunulacak; dağıtımda lisans korunacak. Türkçe karakterler ve sayı hizası uygulamada doğrulanacak.
Rakamlar değişirken genişlik sabit kalmalı; ek font ailesi eklemek yerine uygun sayı özellikleri seçilmeli.
Gövde için 16 px başlangıç; yardımcı metin okunaklı kalır. Boşluk ölçeği 4/8/12/16/24/32 px.

## Yerleşim

Masaüstü: merkez alan esnek, chat yaklaşık 280–320 px; kullanıcı chat’i kapatabilir.

```text
+-----------------------------------------------------------+
| Sollish   Crash  Coinflip   Ödüller  Stake      Cüzdan       |
+-----------------------------------------+-----------------+
| Tur durumu / geçmiş sonuçlar            | Saatlik airdrop |
|                                         | Uygunluk        |
|          Crash sahnesi                  +-----------------+
|          Çarpan + süre                  | Chat            |
|                                         |                 |
+-----------------------------------------+                 |
| Miktar | Beklenen ödeme | Ana eylem      | Mesaj yaz       |
+-----------------------------------------+-----------------+
| Bahislerim / doğrulanmış tur kayıtları                     |
+-----------------------------------------------------------+
```

Mobil: 768 px ve altında chat sütunu kapanır; kullanıcı talebiyle panel olarak açılır.

```text
+-------------------------------+
| Sollish                Cüzdan  |
| Crash  Coinflip   Menü         |
| Tur durumu / geçmiş sonuçlar  |
|                               |
|       Crash sahnesi           |
|                               |
| Miktar / ödeme bilgisi        |
| Bahislerim     Chat / Ödüller  |
+-------------------------------+
| Aktif bahiste: Çıkış yap      |
| Ekran güvenli boşluğu         |
+-------------------------------+
```

Aktif bahiste çıkış kontrolü görünür ve sabit kalır; chat paneli, klavye veya bildirim onu örtmez.
Coinflip aynı kontrol düzenini kullanır; iki tarafın adı, seçilen taraf ve ödeme tutarı açıktır.
Chat ve airdrop varlığı zorunludur; airdrop alanı son saatteki uygunluğu, epoch zamanını ve token ödülünü gösterir.

## Etkileşim, doğruluk ve erişilebilirlik

- Crash manuel çıkış içerir; auto cash-out bunun yerine geçmez. Bahis/çıkış eylemleri konum değiştirmez.
- Durumlar: cüzdan imzası bekleniyor → bahis kabul edildi → tur canlı → çıkış istendi → çıkış kabul edildi → ödeme tamamlandı.
- Her geçiş protokol kanıtına dayanır. Gönderilmiş istek kabul edilmiş veya ödenmiş gibi gösterilmez.
- Brüt ödeme, net sonuç ve işlem ücreti ayrı anlamlar taşır; “cüzdana ödendi” yalnız ödeme doğrulandığında görünür.
- Yeniden bağlantıda durum eşitlenir; belirsiz sonuç açıkça belirtilir. Tekrarlanan çıkış isteği aynı işlem kimliğiyle izlenir; çifte ödeme oluşmaz.
- Önceden seçilmiş bahis, sahte kazanç, uydurma chat/oyuncu sayısı veya kaybı gizleyen kutlama kullanılmaz.
- WCAG 2.2 AA hedeflenir: görünür klavye odağı, semantik kontroller, yeterli kontrast, renge ek durum metni/işareti.
- Ana dokunma hedefleri 44–48 CSS px; bu proje hedefidir. WCAG AA asgarisi istisnalarıyla 24 px’dir.
- Chat yazarken oyun kısayolu tetiklenmez; ekran okuyucuya her animasyon karesi yerine anlamlı durum değişimleri bildirilir.
- Azaltılmış hareket tercihi desteklenir; animasyon kapatıldığında çarpan ve tur durumu anlaşılır kalır.

## Performans ve görsel kabul

- [Core Web Vitals](https://web.dev/articles/vitals): mobil/masaüstü ayrı p75 LCP ≤2,5 sn, INP ≤200 ms, CLS ≤0,1. Bunlar hedef, ölçüm sonucu değildir.
- Proje bütçesi: ilk oyun görünümünün gerekli toplam JavaScript aktarımı gzip ile yaklaşık ≤200 KB hedeflenir; wallet gibi ertelenen paketler ayrıca raporlanır. Henüz garanti edilmez.
- Yerel tıklama geri bildirimi <100 ms hedeflenir; TEE kabulü ve zincir kesinleşmesi ayrı gecikmelerdir.
- Sahne yerelde çizilir; her kare ağdan gelmez. Chat güncellemeleri oyun ağacını bütünüyle yeniden çizdirmez.
- 320/390/768/1440 px genişliklerde ekran görüntüsü: yatay taşma yok; miktar, çarpan, odak ve ana eylem kesilmez.
- Görsel inceleme: cüzdan kapalı/açık, imza reddi, canlı tur, çıkış bekleniyor, kayıp/kazanç, bağlantı kesilmesi, boş kayıt ve uzun chat.
- Mobil klavye, %200 yakınlaştırma ve azaltılmış hareket ayrıca denenir; kabul yalnız güzel bir statik ekran görüntüsüne dayanmaz.
- Next/React sürümleri frontend aşamasında wallet ve Cloudflare OpenNext uyumluluğuyla test edilip kilitlenir; gerçek workerd önizlemesi denenir. ARM64 dağıtım testi VPS'teki arka plan işçisi içindir.

## İncelenen rehberler ve araç durumu

- [Anthropic frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md): tasarım yönü ve öz eleştiri; [Apache-2.0](https://github.com/anthropics/skills/blob/main/skills/frontend-design/LICENSE.txt) doğrulandı.
- [Vercel React Best Practices](https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/SKILL.md): bundle, veri akışı ve render performansı; MIT olarak belirtiliyor.
- [Vercel Web Design Guidelines](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md): uygulama sonrası UX ve erişilebilirlik incelemesi.
- [Next üretim rehberi](https://nextjs.org/docs/app/guides/production-checklist), [WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/) ve [Playwright görsel kontrol](https://playwright.dev/docs/test-snapshots): ölçüm ve kabul dayanakları.
- Bu araştırmada skill’ler incelendi, kurulmadı. Harici tasarım plugin’i bağlantısı veya Claude Design/Opus erişimi doğrulanmadı; belirli model kalitesi vaat edilmiyor.
