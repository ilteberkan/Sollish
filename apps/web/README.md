# Sollish web

Next.js 16.3.8 / React 19.3.0 uygulaması. Varsayılan giriş `/game/crash`; ayrıca `/game/coinflip`, `/rewards`, `/stake` bulunur. Node 24, TypeScript 5.9.3; SDK peer bağımlılığı nedeniyle TypeScript 7 kullanılmaz.

## Yerel kullanım

Depo kökünde `pnpm install --frozen-lockfile`, ardından `pnpm dev`. Yerel adres: `http://127.0.0.1:3000`.

```sh
pnpm --filter @sollish/web typecheck
pnpm --filter @sollish/web test
pnpm --filter @sollish/web exec playwright install chromium
pnpm --filter @sollish/web test:browser
```

Üretim önizlemesinde aynı tarayıcı testleri:

```sh
PLAYWRIGHT_BASE_URL=http://localhost:3001 PLAYWRIGHT_SKIP_WEBSERVER=true pnpm --filter @sollish/web test:browser
PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm --filter @sollish/web exec node scripts/measure-js.mjs
```

Cloudflare derleme/yerel önizleme komutları kök dağıtım belgelerinde açıklanır. Bu uygulamayı oluşturmak veya yerel test etmek cloud dağıtımı yapmaz.

## Veri ve güven sınırları

- **Yerel demo:** 1.000 DEMO deneme kredisi yalnız bellekte tutulur. Gerçek SOL, token, VRF kanıtı veya ödül hakkı değildir. Geçmiş yalnız kullanıcının bu oturumda yaptığı turlardan oluşur. Miktar başlangıçta seçilmez.
- **Crash:** Kullanıcının manuel çıkışına sahiptir. Tıklama anındaki monotonik süre kontrol edilir; gecikmiş animasyon karesi kazanç oluşturmaz. Canlı Crash her zaman kapalıdır; PER doğrulaması bu arayüzle tamamlanmış sayılmaz.
- **Cüzdan:** Wallet Standard keşfi, bağlantı, hesap değişimi ve bağlantı kesme gerçek provider üzerinden çalışır. Paket bağlantı istendiğinde yüklenir. Uygulama demo için cüzdan veya imza istemez.
- **İşlem yaşam döngüsü:** Ön inceleme belirli cüzdan bağlantısına aittir. Cüzdan değişimi, bağlantı kesilmesi veya ekranın kapanması, hazırlık sonundaki kontrolde imza çağrısını durdurur. İmza çağrısı başladıktan sonraki belirsizlikte eski işlemin takibi korunur; yeni cüzdanla otomatik tekrar yapılmaz.
- **Coinflip:** Yapılandırma yoksa devnet bahsi kapalıdır. Açık yapılandırmada SDK yerel talimat üretir, devnet genesis/hesap/rezerv kontrolü yapar, ardından kullanıcı cüzdanında onaylar. Gönderim onayı ödeme sayılmaz; sonuç `finalized` hesap okumasıyla gösterilir.
- **Belirsiz gönderim:** Son hazırlanan bahis kimliği ve hesap adresi, imzadan önce `sessionStorage` içinde saklanır. Bu kayıt yalnız genel zincir verisidir; özel anahtar veya JWT içermez. Sonuç bilinmeden otomatik yeniden bahis yoktur. Kayıp/muhtemelen kapanmış makbuz kazanç veya kayıp diye yorumlanmaz.
- **Chat:** API/Supabase ayarı yoksa boş ve kapalıdır. Supabase giriş paketi yalnız açık bir oturum açma eyleminde yüklenir. Mesaj imzası işlem izni değildir. JWT bellekte kalır, WebSocket ilk auth frame’inde gider; URL veya loga yazılmaz. Mesajlar gerçek sunucu olaylarıdır; iyimser sahte mesaj eklenmez. Sequence boşluğunda replay istenir.
- **Ödüller/stake:** Token veya havuz yapılandırılmadan miktar, getiri, geri sayım veya hak uydurulmaz. Yapılandırılmış devnet havuzunda stake, çözme, stake/oyun/saatlik ödül talepleri gerçek SDK üzerinden ön inceleme → cüzdan → kesinlik takibi sırasını izler. Talep tahmini, ödenen miktarın kanıtı diye sunulmaz. `NEXT_PUBLIC_INCENTIVES_ENABLED` oyun kabul anahtarından bağımsızdır; Coinflip duraklatıldığında çözme/talep erişimi sırf bu nedenle kapanmaz. Demo oyunları uygunluk sağlamaz.
- **Saatlik hak:** Son tamamlanan UTC saati gösterilir. Eşiği geçen cüzdanların uygun bahis hacmiyle orantılı pay kullanılır; chat’in kayan son 60 dakika şartıyla karıştırılmaz. İlk talep kapanmış saati mühürleyebilir. Oyun ödül katılımı canlı Coinflip formunda isteğe bağlıdır ve başlangıçta seçili değildir.

`.env.example` yalnız genel tarayıcı ayarlarını gösterir. `NEXT_PUBLIC_` alanları kullanıcıya görünür; RPC URL’lerine gizli sağlayıcı anahtarı eklenmemelidir. Next yapılandırması, Supabase public-key alanında `sb_secret_` veya legacy `service_role` bulunursa derlemeyi durdurur; hata anahtar değerini yazmaz.

## Görsel ve erişilebilirlik doğrulaması

Playwright testleri 320/390/768/1440 px ekran görüntülerini `.tooling/web-screenshots` altına yazar. Testler manuel cashout, anında kayıp, çift tıklama, Coinflip, kapalı canlı erişim, cüzdan ve chat modalları, klavye odağı ve azaltılmış hareketi kapsar. Axe WCAG 2.2 AA otomatik taraması tam erişilebilirlik sertifikası değildir. %200 tarayıcı yakınlaştırmasının reflow karşılığı 720 CSS px / 2 DPR ile taklit edilir; işletim sistemi tarayıcı araç çubuğu ve fiziksel mobil klavye ayrıca elle denenmelidir.

JavaScript ölçüm script’i yalnız localhost üzerinde çalışır. İndirilen gövdeleri Node gzip ile tekrar sıkıştırır; CDN aktarım miktarı veya sahadan Core Web Vitals sonucu değildir. 200 KiB ilk JavaScript bütçesi proje hedefidir. Gerçek p75 LCP/INP/CLS için kullanım verisi gerekir.

Barlow 400/500/600 WOFF2 dosyaları [tasarımcının resmi deposundan](https://github.com/jpt/barlow/tree/main/fonts/woff2) alınmıştır. SIL OFL lisansı `public/fonts/OFL.txt` dosyasında korunur. Harici font veya görsel isteği yoktur.
