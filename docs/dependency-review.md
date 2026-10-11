# Bağımlılık incelemesi — 1 Ekim 2026

`pnpm-lock.yaml` sürümleri kilitler; Node24.21.0 ve TypeScript5.9.3 kullanılır. TypeScript7'ye geçilmedi: pinli Solana codec'lerinin desteklediği peer aralığı5.x. Kilit dosyası strict peer doğrulamasıyla üretilmiştir.

Prod taraması: `bash scripts/use-node.sh pnpm audit --prod --json`. Sonuç1 moderate,0 high,0 critical. Bu sonuç bağımsız uygulama güvenlik denetimi değildir. CI high/critical bulguda durur; moderate raporu görünür kalır. Dependabot npm/Cargo/Actions güncellemelerini açacak şekilde tanımlıdır; uzakta çalışmış değildir.

## Giderilen uuid bulgusu

Jayson'un kullandığı `uuid` 8.3.2, `jayson>uuid:11.1.1` ile güncellendi. Jayson yalnız `.v4()` çağırır;11.1.1 CommonJS arayüzünü korur. Override sonrası backend testleri ve paket derlemesi geçti; tarama uuid uyarısını artık üretmiyor. [Sağlayıcı duyurusu](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq).

## Açık stream-json bulgusu

`@solana/web3.js → jayson4.3.0 → stream-json1.9.1`: [GHSA-528h-pc64-c93x](https://github.com/uhop/stream-json/security/advisories/GHSA-528h-pc64-c93x). Duyurudaki sorun pick/ignore/filter/replace yol filtrelerinde aşırı iç içe JSON üzerinde karesel maliyettir; aynı duyuru streamValues akışını kapsam dışında belirtir.

Kurulu Jayson kaynakları `lib/utils.js` içinde yalnız `stream-json/streamers/StreamValues` ve `stream-json/utils/Verifier` kullanıyor. Web istemcisi browser JSON-RPC istemcisini kullanıyor; worker halka açık Jayson JSON-RPC sunucusu açmıyor. Proje kaynaklarında stream-json filtre kullanımı yok. Bu çağrı yolları için bilinen hatanın erişilebilir olduğu saptanmadı; paket kendisi hâlâ etkilenmiş sürümdür ve taramada saklanmaz. Jayson upstream uyumlu sürüme geçince yeniden değerlendirilmelidir.3.5'e kontrolsüz major override uygulanmadı.

## Native modüller

`utf-8-validate` yalnız opsiyonel hızlandırıcıdır ve workspace'ten çıkarıldı. ws7 tam JavaScript UTF8 doğrulayıcısını korur; ws8/Node24 yerleşik `buffer.isUtf8` kullanır. Böylece ws7'nin5.x/ws8'in6.x opsiyonel native peer çakışması strict doğrulama kapatılmadan çözülür. İzin verilen install build-script'leri esbuild, sharp ve workerd ile sınırlıdır.

## Ayrı PER deney paketi

`experiments/per/package-lock.json` ayrı npm grafiğidir; workspace taraması bunu kapsamaz. Burada da yalnız Jayson'un `uuid` bağımlılığı11.1.1'e sabitlendi. `npm install --ignore-scripts` sonrasında temiz kaynak kopyasında47/47 istemci testi ve gerçek yerel ELF/hash testi1/1 geçti. Deney paketinin audit ve Dependabot kontrolü CI'a ayrıca eklendi.

Son `npm --prefix experiments/per audit --omit=dev --json` sonucu **3low/3moderate/0high/0critical etkilenmiş paket**, **iki farklı duyuru** gösterir: yukarıdaki stream-json ve [elliptic GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84). Üst paketlere yayılan sonuçlar ayrı açıklar gibi sayılmaz. Kanıt: `.tooling/per-npm-audit-final.json`. `npm audit fix --force` önerdiği eski ana SDK sürümlerine dönüş uygulanmadı.

Elliptic duyurusu ECDSA **imza üretiminde** nonce kırpılması ve koşullu gizli anahtar sızıntısı hakkındadır; duyuruda yamalı sürüm yoktur. Kurulu `@phala/dcap-qvl0.3.9/src/crypto-compat.js`, Node'da yerleşik `crypto.X509Certificate/createVerify` kullanır. Node24.21.0 üzerinde `isBrowser:false` ve yerleşik X509 sınıfı eşitliği doğrudan doğrulandı. Elliptic fallback yalnız browser dalında public key ile imza doğrulamaktadır; deneyimiz bu kütüphaneyle ECDSA imzası üretmez. Mevcut kullanım yolunda bu imza üretim hatasına erişim saptanmadı; etkilenmiş paket bulunduğu ve başka kripto risklerini dışlamadığı açıkça korunur. Bu analiz canlı TEE güvenini veya audit onayını sağlamaz.
