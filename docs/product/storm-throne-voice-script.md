# Tarhun: Fırtına Tahtı — seslendirme metni

Karakter: Anadolu'nun tunç çağı fırtına tanrısından esinlenen **özgün** bir karakter. Derin, gür, yaşlı ama güçlü; kendinden emin, hafif alaycı, sıcak bir kahkaha. Başka bir oyunun karakterini veya seslendirmesini taklit etmez.

Üretim (higgsfield.ai web sitesi):
- Model: Text to Speech V2, motor **ElevenLabs** (Türkçe telaffuz en iyi). Yedek: Seed Audio.
- Ses: derin erkek preset (aday sırası: Gideon, Orion, Barrett, Vlad). Önce aşağıdaki deneme repliğini dört sesle üret, en "tanrısal" olanı seç; bütün replikleri aynı sesle üret.
- Biçim: WAV veya MP3, 44,1/48 kHz. Her replik ayrı dosya; başta ve sonda en fazla 0,2 sn sessizlik.
- Dosyaları aşağıdaki adlarla `apps/web/public/audio/voice/storm/` klasörüne koyacağız (bana göndermen yeterli).

Deneme repliği: «Gökler benim! Fırtına başlıyor... Yüz kat!»

| Dosya adı | Replik | Ne zaman |
|---|---|---|
| `x2-9.mp3` | «Güç!» | çarpan ×2–×9 |
| `x10.mp3` | «On kat!» | çarpan ≥×10 |
| `x25.mp3` | «Yirmi beş kat!» | çarpan ≥×25 |
| `x50.mp3` | «Elli kat!» | çarpan ≥×50 |
| `x100.mp3` | «Yüz kat!» | çarpan ≥×100 |
| `x250.mp3` | «İki yüz elli kat!» | çarpan ≥×250 |
| `x500.mp3` | «Beş yüz kat!» | çarpan ×500 |
| `scatter-tease.mp3` | «Hissediyorum...» | 3 scatter görünce |
| `feature-trigger.mp3` | «Fırtına başlıyor!» | bedava dönüş tetiklendi |
| `feature-start.mp3` | «Gökler açıldı!» | bedava dönüş başlıyor |
| `retrigger.mp3` | «Daha fazlası!» | +5 dönüş |
| `win-big.mp3` | «Büyük kazanç!» | ≥10× |
| `win-mega.mp3` | «Mega kazanç!» | ≥25× |
| `win-super.mp3` | «Süper kazanç!» | ≥50× |
| `win-legend.mp3` | «Efsane kazanç!» | ≥100× |
| `win-max.mp3` | «Azami kazanç! Gökler senin!» | tavan |
| `laugh.mp3` | «Ha ha haaa!» (gür, sıcak kahkaha) | büyük düşme zinciri |
| `nice.mp3` | «Güzel!» | orta kazanç (seyrek) |
| `feature-end.mp3` | «Fırtına dindi.» | bedava dönüş toplam ekranı |

Toplam 19 replik ve 4 deneme repliği. Maliyet ön kontrolü (12 Ekim 2026): ElevenLabs ile replik başına 0,15 kredi, yani toplam yaklaşık 3,5 kredi.
