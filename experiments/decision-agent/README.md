# TypeSafe Jev karar adaptörü ve Combat Club stil katmanı

İki parça var: (1) bu klasördeki izole Node deneyi (`typesafe-client.mjs`), (2) ürünün sunucu yolu: `apps/web/app/api/ringside/style/route.ts` + `apps/web/lib/server/typesafe-style.ts`. Jev yalnız altı stil etiketinden birini seçer (`pressure`, `counter`, `cautious`, `outboxer`, `body`, `finisher`). Bahis, bakiye, kimlik, işlem, araç veya sonuç yetkisi yoktur; cevabı kapalı şemadan geçmeyen her durum sabit bir koda ve tarayıcıda deterministik `fallbackStyle` kuralına düşer. Combat Club bahissiz bir izleme yüzeyidir.

## Sağlayıcı sözleşmesi

Resmî [API](https://docs.typesafe.ai/api), [Choice](https://docs.typesafe.ai/primitives/choice), [modeller](https://docs.typesafe.ai/models) ve [public OpenAPI](https://api.typesafe.ai/openapi.json). 4 Ekim 2026'da OpenAPI anonim olarak yeniden alındı; SHA-256 `a191f8a7…60d5` değişmemiş (`evidence/provider-contract.json`). Modeller sayfası güncel sürümü `jev-1.13.0` olarak listeliyor; `jev-latest` ve `jev-preview` buna işaret eden takma adlar, sürümlü kimlikler doğrudan kabul ediliyor. Model `jev-1.13.0`'a sabit; hareketli alias kullanılmaz, farklı model döndüren cevap reddedilir. Gerçek çağrılarda sabit model kabul edildi.

- `POST https://api.typesafe.ai/v1/systemone`, JSON, Bearer. Gövde `model`, `state`, `questions`; tek Choice sorusu (`type`, `instructions`, `criteria`).
- Cevap `model`, `answers`, `usage`; Choice `type`, `choice`, `confidence`, `probabilities`. Seçim arg-max olmalı (eşitlik kabul), altı olasılığın toplamı 1 ± 0,030001 (yeniden normalize edilmez), fazladan alan reddedilir.

## Stil sorusu (deney ve ürün aynı metni sorar; web birim testi sapmayı yakalar)

`state` kapalı, yalnız tamsayı/enum bir gözlemdir (`packages/protocol/src/fight-style.ts` → `styleObservation`): `point` (start/midround/roundend), `round`, `rounds`, `roundSecondsLeft`, `me` ve `opponent` için `health` ve `stamina` (0–1000), `knockdowns`, `cardPoints`, son 15 saniyenin `recent` sayıları (`thrown`, `landed`, `blocked`, `slipped`, `counters`; her biri o dövüşçünün kendi yumrukları). Seed, tick, konum, kimlik, bahis veya bakiye yoktur. Karar noktaları: maç başlamadan (tick 0), her raunt sonunda (bir sonraki raunt başlangıcında uygulanır) ve raunt içinde her 900 dövüş tick'inde (120 tick sonra uygulanır). 3×45 sn'lik Combat Club maçında köşe başına 9 karar, iki Jev köşesiyle 18 istek.

## Determinizm

Simülasyon, karar `applyTick`'ine geldiğinde karar kesinleşene kadar bekler (yalnız sunum; ekranda "Jev düşünüyor…"). Kesinleşen karar Jev cevabı ya da süre dolunca `fallbackStyle(gözlem)` olur. Maç = (motor sürümü, seed, maç biçimi, köşeler, karar kaydı); ağ hızı sonuca girmez. Her karar gözlemin kanonik JSON'unun SHA-256'sını (`obsHash`) taşır; tekrar oynatma gözlemi yeniden hesaplayıp eşleşmeyen kaydı reddeder. Kayıt arayüzden indirilip ağ çağrısı olmadan yeniden oynatılabilir.

## Ürün rotası

- `GET /api/ringside/style` → yalnız `{ enabled, model }`.
- `POST` → kapalı şema `{ side, requestTick, observation }`; cevap `{ style, source: "jev", model, confidence }` ya da `{ source: "fallback", code }`.
- Etkin olması için sunucu ortamında `DECISION_AGENT_ENABLED=true` ve geçerli `TYPESAFE_API_KEY` gerekir; anahtar asla `NEXT_PUBLIC_` değildir, tarayıcı paketine girmez (`'server-only'` korumalı rota; istemci modülleri `lib/server`'ı içe aktaramaz — birim testi), loglanmaz, döndürülmez.
- Sertleştirme: aynı köken (Origin host = Host; `next dev`'de `request.url` genel kökeni taşımıyor), yalnız JSON, 4 KiB istek sınırı, gövde okumayı kapsayan 1500 ms sağlayıcı süresi, 16 KiB cevap sınırı, `redirect: "manual"` + 3xx/opaque/yabancı URL reddi (workerd `"error"` kabul etmez), tam anahtar doğrulaması, otomatik tekrar yok. Süreç başına sınır: 4 eşzamanlı, 10 sn'de 24, ömür boyu 600 sağlayıcı isteği (Workers'ta izolat başına; küresel kota değildir). Log satırı yalnız kod, süre, deneme no ve token sayısı.

## Gerçek çağrılar (4–5 Ekim 2026, bu Mac; toplam 68/150)

Görev bütçesi 150 kimlik doğrulamalı istek. Her gerçek çağrı yapıldığı anda `evidence/style-real-calls.jsonl`'a bir satır olarak yazılır (kod, ms, token, stil, güven; gövde/anahtar yok). Özet: `evidence/style-benchmark.json` (`summarize-style-evidence.mjs`).

- **Gecikme/geçerlilik (30 ardışık çağrı, Node, ürünün sunucu istemcisi):** 30/30 OK, şema doğrulaması geçti. Gecikme p50 281 ms, p90 337 ms, en yüksek 481 ms; girdi ~850 token (848–852), çıktı 65–67 token. Seçimler: cautious 14, pressure 10, counter 5, outboxer 1 (body/finisher hiç). Güven p50 0,55 (0,2–0,9). Yedek kuralla aynı seçim oranı 0,50 (betimleyici; karar kalitesi ölçülmedi). Gözlemler gerçek Combat Club maçlarının karar noktalarından (seed 6101–6106, iki köşe neuro-2 Jev stratejisti, yedek yol).
- **Rota canlı denetimi (`next dev`, :3000):** yabancı köken 403, fazladan alan 400 (sağlayıcıya gitmeden); 2/2 geçerli istek OK, uçtan uca 497 / 302 ms (sağlayıcı 479 / 279 ms). İlk denemede köken denetimi `request.url`'e baktığı için iki istek sağlayıcıya gitmeden 403 aldı; JSONL'da `providerCall:false` olarak işaretli, düzeltildi.

- **Gerçek sahne, iki canlı Jev köşesi (`next dev` :3000, başsız Chromium + GPU WebGL; üretim derlemesi değil, barındırılmış değil):** seed 20261041, tam 3×45 sn maç bitti (tick 9060). 18/18 karar `jev` olarak kesinleşti, yedeğe düşen yok. Tarayıcıdan rota üzerinden uçtan uca p50 584 ms (407–1524 ms); rotanın ölçtüğü sağlayıcı süresi p50 484 ms, en yüksek 1221 ms (makine yoğun yük altındaydı). Simülasyon yalnız başlangıç kararında kısa süre bekledi ("Jev düşünüyor…"); raunt içi kararlar 2 sn'lik öndelik içinde geldi. Kayıt ve zamanlamalar: `evidence/style-bout-20261041.json` (neuro-2 geçici modeliyle).
- **Aynı sahne, son neuro-2 modeli (`provisional:false`, theta `c39c3107…`):** seed 20261043, tam maç; 18/18 `jev`, uçtan uca p50 389 ms (345–529), sağlayıcı p50 369 ms (en yüksek 483). Seçimler counter 8, outboxer 7, pressure 3. `evidence/style-bout-20261043.json`.
- **Jev aynı gözleme her zaman aynı cevabı vermiyor:** aynı başlangıç gözlemine 5 kez `pressure` dedi ama güven 0,31–0,43 arasında değişti; ayna maçta iki köşe birebir aynı gözlemi 5 kez aldı ve birinde farklı stil seçildi (t1800: outboxer / pressure). Bu yüzden tam tekrar yalnız kesinleşmiş kayıttan yapılır; önbellek bir gözleme verilmiş *önceki* cevaptır, maç tekrarı değildir.
- **Gerçek sahne, öğrenilmiş stratejistler (ağ yok):** masaüstü 14 sn ve 390×844 tam maç; sağlayıcı isteği 0. Geçici neuro-2 stratejisti tick 0'da stil seçti ve maç boyunca değiştirmedi (olasılıklar ~%17). Son modelle Node'da 6 ayna maçta köşe başına 1–2 öğrenilmiş karar (çoğu 3. saniyede `pressure`'a geçiş), 6/6 kayıttan birebir tekrar; 6 maçın 6'sı kartlarda beraberlik (neuro-2 kanıtındaki %86 beraberlikle uyumlu).
- Ekran görüntüleri ve kayıtlar: `ops/evidence/ringside-style-20261004/`.

## Deney istemcisi (Node, `typesafe-client.mjs`)

Seçim listesi artık parametredir (`choiceRequest(spec, state)`, `parseChoice(value, spec)`; `ACTION_SPEC`, `STYLE_SPEC`). Eski hareket önerisi API'si aynen durur (`decisionRequest`, `parseDecision`, `decide`; altı hareket, gözlem `tick`, `distanceMeters`, `stamina`, `opponentStamina`, `opponentAction`, `lastAction`). Yeni: `styleRequest`, `parseStyleDecision`, `decideStyle`, `styleOrFallback(client, gözlem, yedek)` (hiç atmaz, tekrar denemez). Varsayılan sınırlar değişmedi: tek eşzamanlı çağrı, istemci başına 8 girişim, en az 250 ms başlangıç aralığı, gövdeyi kapsayan 1500 ms, 16 KiB, redirect/cookie/referrer yok, sabit köken. Telemetri yalnız sabit kod, süre, deneme no, izinli seçim ve token sayısı. `typesafe-client.d.mts` yalnız web birim testinin tipleri içindir.

```sh
bash scripts/use-node.sh node --test experiments/decision-agent/test/*.test.mjs   # 21 test, ağ engelli
```

Gerçek ölçüm betikleri anahtarı yalnız çocuk sürece alır: `set -a; . ./.tooling/secrets/typesafe.env; set +a; bash scripts/use-node.sh apps/web/node_modules/.bin/tsx experiments/decision-agent/style-benchmark.ts 30` (`dry` argümanı çağrı yapmadan gözlemleri sayar). Betikler her çağrıdan önce toplam sayıyı denetler ve 150'de durur; iki ardışık sağlayıcı reddinde durur.

## Önbellek ("Jev kaydı", çevrimdışı)

`build-style-cache.ts`, gerçek Jev cevaplarını (`obsHash` → stil, güven; ilk kayıt kazanır) `apps/web/lib/jev-style-cache.json`'a yazar, kaynak dosyaların SHA-256'larını tabloya koyar ve tablonun kanonik özetini `apps/web/lib/jev-style-cache.ts`'e sabitler. Özet tutmazsa her arama ıskalar. "Sinek beyni v2 · Jev kaydı (çevrimdışı)" köşesi ağ kullanmaz: eşleşen gözlemde `önbellek`, yoksa `yedek kural`. Önbellek cevabı canlı diye gösterilmez. Eşleşme gözlemin birebir aynı olmasını ister: başlangıç gözlemi her maçta aynıdır; tam bir maçın tekrarı ancak aynı seed, köşeler, motor ve neuro-2 modeliyle kaydedilmiş bir maçta olur.

## Anahtar, önizleme ve yayın (araştırma; uygulanmadı)

Bu repodaki `@opennextjs/cloudflare` 1.20.7 ve wrangler 4.145.0 kaynak kodu okunarak:

- `opennextjs-cloudflare build`, `compileEnvFiles` ile monorepo kökündeki ve `apps/web`'deki `.env`, `.env.<mod>`, `.env.local`, `.env.<mod>.local` dosyalarının **bütün anahtar/değerlerini** `.open-next/cloudflare/next-env.mjs` içine yazar; bu modül worker'a paketlenir ve deploy ile yüklenir. Yani `.env*` dosyasına konan bir sır derleme çıktısına gömülür. Mevcut `.open-next/cloudflare/next-env.mjs` (4 Ekim 08:11 derlemesi) yalnız `apps/web/.env.production.local`'daki beş `NEXT_PUBLIC_*` anahtarını içeriyor (değerler okunmadı). `.dev.vars` derlemede okunmaz.
- Çalışma anında worker ilk istekte `populateProcessEnv` ile Workers `env`'indeki her metin bağını (vars + secrets) `process.env`'e kopyalar, eksikleri gömülü `next-env.mjs`'den doldurur. Rota `process.env`'i istek anında okuduğu için secret ile çalışır; GET `force-dynamic` olduğundan derlemede statik cevaba dönüşmez.
- Yerel önizleme (`opennextjs-cloudflare preview` = `wrangler dev`): wrangler `.dev.vars`'ı, yoksa `.env`/`.env.local`'ı çalışma anında secret bağı olarak yükler; tanınmayan argümanları `wrangler dev`'e geçirir. Önerilen güvenli yol (uygulama klasörüne dosya koymadan): `pnpm --filter @sollish/web exec opennextjs-cloudflare preview --port 3001 --env-file=/Users/macmini/Desktop/Sollish/.tooling/secrets/typesafe.env --var DECISION_AGENT_ENABLED:true`. `--env-file` verilince `.dev.vars` okunmaz; anahtar `.open-next`'e yazılmaz. Kullanmadan önce `wrangler dev --help` ile bayrakları doğrulayın. `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` bütün kabuk ortamını worker'a taşıdığı için önerilmez; `apps/web/.env*` kesinlikle kullanılmamalı.
- Üretim (sahibin onayı gerekir): `wrangler secret put TYPESAFE_API_KEY` (değer dosyadan/stdin'den, ekrana yazmadan) ve `DECISION_AGENT_ENABLED` değişkeni (`wrangler.jsonc` `vars` ya da secret). Bunlar yoksa barındırılan demo `enabled:false` döner, canlı Jev seçeneği gerekçesiyle kapalı görünür, çevrimdışı "Jev kaydı" çalışır. `global_fetch_strictly_public` bayrağı api.typesafe.ai'ye çağrıyı engellemez.

## Sınırlar

Jev'in stil seçiminin maç sonucuna veya izlenebilirliğe katkısı ölçülmedi; yedek kuralla uyum yalnız betimleyicidir. neuro-2 modeli şu an geçicidir (`provisional: true`); stil girdisinin davranışa etkisi son modelle ölçülmelidir. Gecikme tek ağdan, tek Mac'ten, ardışık ölçüldü; eşzamanlılık ve barındırılan ortam ölçülmedi. Sağlayıcı zaman aşımına uğrayan bir isteği ücretlendirmiş olabilir. Süreç başına sınırlar maliyet emniyetidir, küresel kota değildir.

## Jeeves / Jev / RL ayrımı

[PostHog Jeeves](https://github.com/PostHog/jeeves), Qwen3.5-9B üzerine LoRA/pointer head kullanan SFT+CISPO karar modelidir. Yerel Jev-compatible sunucu sunar; [serve.py](https://github.com/PostHog/jeeves/blob/master/inference/serve.py) varsayılanı localhost:8009'dur. TypeSafe API anahtarı bu yerel sunucu için gerekmez. Bu adaptör yerel Jeeves'e bağlanmaz.

TypeSafe'in [resmî açıklaması](https://typesafe.ai/blog/introducing-system-one-models-and-jev) Jev'i RLCD ile eğitilmiş yapılandırılmış karar modeli olarak tanımlar. Bu, biyolojik konnektom veya eğitilmiş fizik tabanlı boks kontrol politikası değildir; böyle bir ilişki kaynaklarda kurulmamıştır. Şema garantisi kararın doğru olduğu garantisi değildir.

Jeeves README'nin kendi ölçümlerinde CUDA veya Apple Silicon MPS öneriliyor; fp8 ağırlıklar tek başına yaklaşık 11.5GB, bf16 yaklaşık 21GB. GPU'suz ARM/8GB VPS üzerinde kullanılabilir bir kurulum doğrulanmış değildir; mevcut VPS'e sığan/uygun bir çözüm diye sunulmamalı. Eğitim/çıkarım kurulmadı, ağırlık indirilmedi, ücretli kaynak açılmadı.
