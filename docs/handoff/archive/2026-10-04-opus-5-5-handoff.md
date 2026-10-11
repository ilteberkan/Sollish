# Sollish — Claude Opus 5.5 devir talimatı ve uygulama iş emri

**Devir tarihi:** 4 Ekim 2026, Europe/Istanbul. **Çalışma klasörü:** `/Users/macmini/Desktop/Sollish`.

Bu dosya, önceki sohbet olmadan projeyi devralman için hazırlanmıştır. Projenin kodu bu dosyanın içinde değildir; aynı çalışma klasörüne erişmen gerekir. Claude Code'da bu dosyayı açıkça okuyarak başla; yalnız bir web sohbetine yüklemek dosya sistemi, terminal veya servis erişimi sağlamaz. Hedef model Claude Opus 5.5'tir; gerçek model seçimi istemcide yapılır, bu metin modeli değiştirmez. Resmî API kimliği `claude-opus-5-5` olarak doğrulandı.

**Ana görev:** Mevcut Sollish projesini koruyarak devam ettir. En acil ürün sorunu Ringside'ın düşük dövüş ve görsel kalitesidir. Bunu lisanslı varlıklar, ölçülmüş mekanikler, gerçek öğrenme ve uygun fizik altyapısıyla çöz; ardından açık protokol, ödeme, altyapı ve ürün işlerini tamamla. Kullanıcı yeni bir basit demo veya yeni bir plan döngüsü istemiyor. Çalışan değişiklik, gerçek doğrulama ve açık sınırlar istiyor.

<project_context>

## 1. Kullanıcının hedefi ve değişmeyen kararlar

- Solana üzerinde non-custodial oyun platformu: başlangıçta **Coinflip + canlı manuel cash-out zorunlu Crash**. Bahis cüzdandan sözleşmeye, doğrulanmış ödeme kayıtlı oyuncuya gider. “Anında” ödeme, ölçülmemiş gecikme garantisi değildir.
- SOLO oyunlar ile çok kullanıcının aynı maçı izleyip bahis verdiği shared LIVE oyunlar ayrı yaşam döngüleridir. Aynı görseli kullanmaları aynı ledger veya aynı otoriteyi kullanmaları anlamına gelmez.
- Özgün 3D oyunlar ortak mimarinin parçasıdır. İlk oyun Ringside; KOR/AYAZ dövüşçüleri, hakem, ring, kamera ve izleme deneyimi amatör görünmemelidir. Referans mekanik seviyesi Fight Arena Online ve diğer iyi tarayıcı dövüş oyunlarıdır. Rakibin kodunu, modelini, markasını veya lisanssız animasyonunu kopyalama.
- Kullanıcıların asıl Ringside rolü dövüşçülere/raunt pazarlarına bahis vermektir. Sonradan eklenen elle oynanabilir Combat Club, dövüş mekaniğini sınamak içindir; bunu bütün ürünü oyuncu kontrollü bir kumar oyununa dönüştürme onayı olarak yorumlama.
- Canlı chat ve saatlik airdrop zorunlu. Airdrop **platform token'ı**, SOL değil. Chat yazma uygunluğu son kayan 60 dakikadaki doğrulanmış bahis hacmine bağlıdır; kesin minimum ürün parametresidir, uydurma.
- Token arz hedefi **1.000.000.000**; aşamalı oyun ödülleri, staking, fonlanmış ödül havuzları, ileride buyback/burn. Platform tamamlandıktan sonra Pump.fun launch ve marketing. Token ayrıntıları mühendislik araştırmasına bırakılmıştır; bu, sınırsız bütçe veya otomatik launch izni değildir.
- Planlanan house sermayesi **1 SOL**. Bu güncel cüzdan bakiyesi değildir; devnet test SOL'ü, operasyon/audit/asset/token edinim bütçeleriyle karıştırma.
- Global erişim hedefleniyor; her ülkeye koşulsuz gerçek bahis açma veya hukuk/sağlayıcı koşullarını atlama kararı yoktur.
- Mevcut yön: **Cloudflare + managed Supabase + mevcut ARM VPS**. Kullanıcı binlerce kullanıcı için sonradan platformu yeniden yazmak istemiyor; kota ve kapasiteyi ölçerek büyüt. Ücretsiz planların sınırsız yük taşıdığını söyleme.
- Modern, koyu, kullanışlı, özgün ve mobil uyumlu arayüz isteniyor. Kullanıcı mevcut kaliteyi tekrar tekrar reddetti. Önceki asistanın “yayımlandı” demesi ürünün görsel kabulünü karşılamaz.
- Fiziksel telefon testi kullanıcı tarafından ürün daha ilerlediğinde yapılacak. Şimdilik emülasyon/simülatör kullan; bunu fiziksel iPhone/Android testi diye raporlama.
- Gereksiz onaylarla durma. Mevcut kapsam içindeki geri alınabilir kodlama, araştırma ve yerel doğrulamayı sürdür. Ödeme, lisans satın alma, yeni yetki, kalıcı veri silme veya mainnet açılışı için gerçek kapsam ve gerekli kullanıcı kararı ayrıdır.

## 2. 4 Ekim'de yeniden kontrol edilen durum

Bu devir hazırlanırken kod değiştirilmedi; çalışma ağacı, kaynak hashleri, kayıtlar, resmî Anthropic rehberleri ve Cloudflare deployment metadatası kontrol edildi. Oyun testlerinin tamamı yeniden çalıştırılmadı. Supabase, VPS ve devnet bakiyesi bu tur yeniden sorgulanmadı.

| Kontrol | Sonuç / kanıt kapsamı |
|---|---|
| Git | `HEAD` commit'i yok; bütün çalışma ağacı untracked. **`git clean`, hard reset, checkout ile mevcut dosyaları yok etme.** Handoff başka makineye gidecekse sadece Git remote'a güvenme. |
| Son Combat Club kaynakları | `ops/evidence/ringside-sparring-20261003.json` içindeki 20 kaynak/asset SHA256 mevcut dosyalarla eşleşiyor. |
| Web aktif Worker | `sollish-web-devnet`; version `93645ad3-1955-4f7d-b947-c495d6b604f6`, deployment `bb9914b8-c62e-4679-a97a-32778b649c77`; Cloudflare MCP ile %100 aktif doğrulandı. |
| Web build | `yTTEY4MG5gmewPMEL9MsM`; son release kaydındaki kimlik. |
| Realtime aktif Worker | `sollish-realtime`; version `fd489ab1-98ab-4aa9-8dc7-d010717747c9`, deployment `5a7add8e-9b57-42cb-a7f7-38085612a98d`; %100 aktif doğrulandı. |
| Gerçek varlık kapıları | `scripts/check-launch-readiness.mjs` yeniden çalıştı: `BLOCKED`, `productionApproved:false`, `evidenceStatus:CONSISTENT`, exit 2. Dokuz kapının hepsi açık. |
| Hosted oynanış gözlemi | 3 Ekim son sürüm: gerçek 1280×720 WebGL, bot dövüşü, sağlık/enerji/olay güncellemesi, pause/resume ve kameralar; JS hata kaydı boş. 4 Ekim yeniden oynanış testi yapılmadı. |

**Kanıt önceliği:** çalışan kaynak + sürüm/hash bağlı ölçüm + tarihli servis gözlemi. README veya eski bir rapordaki gelecek zaman ifadesini son gerçek durum sanma. Özellikle README'nin araştırma özetleri ve product spec'in önceki tarihsel paragrafları güncel motor deneylerinin gerisinde kalabilir. Çelişkiyi açıkça belirt; başarısız eski ölçümü silerek çözme.

## 3. Ürün yüzeyleri: birbirine karıştırma

Public kök: `https://sollish-web-devnet.sollish-web.workers.dev`.

| Yol | Mevcut kapsam | Otorite / sınır |
|---|---|---|
| `/games` | SOLO, LIVE ve Lab yönlendirmeleri | Lobi; finansal kabul kanıtı değil |
| `/game/crash` | Manuel çıkışlı yerel DEMO | Tarayıcı zamanı/kredisi; gerçek gizli Crash protokolü değil |
| `/game/coinflip` | Yerel DEMO ve kapalı gerçek işlem entegrasyon yüzeyi | DEMO, gerçek SOL ve VRF kanıtı değil |
| `/game/boxing` | Eski SOLO Ringside demo | Tarayıcı kredisi, shared LIVE ledger'ından ayrı |
| `/live/boxing` | Eski shared v1 demo | 5 sn giriş; kalıcı DO demo bilet/kredi defteri |
| `/live/ringside-v2` | Korunan shared v2 demo | 20 sn giriş / 60 sn dövüş / 10 sn sonuç; eski bilet kuralları korunur |
| `/live/ringside` | **Contact v3** shared demo | En fazla 3 raunt; her rauntta 20 sn kabul / 45 sn simülasyon / 10 sn ara-sonuç; raunt başına ayrı havuzlar |
| `/lab/ringside` | Öğrenme ve beden araştırması | Hash doğrulamalı kaydedilmiş deneyler; gerçek bahis veya canlı eğitim otoritesi değil |
| `/lab/ringside/play` | **Combat Club / sparring-1**, son eklenen sürüm | 90 sn veya KO; “Kendin oyna” / “Dövüşü izle”; yerel 60 Hz, scripted bot; bahis yok |
| `/rewards`, `/stake` | Ödül/staking arayüzleri ve istemci yolu | Fonlanmış mint/faz/deployment ve kabul koşulları tamamlanmadan canlı sayılmaz |

“LIVE” burada ortak sunucu turunu anlatır; gerçek SOL kabul edildiği anlamına gelmez. İlk 5 saniye talebi daha sonra Contact v3'te daha uzun ve raunt bazlı akışa evrildi; bütün sürümleri yeniden 5 saniyeye indirme.

## 4. Mimari ve kod haritası

| Katman | Kaynak | Görev / bugünkü durum |
|---|---|---|
| Oyun matematiği | `crates/game-math/` | Tamsayı oran/rezerv matematiği; ilgili Rust testleri |
| House | `programs/house/` | Escrow, fonlanmış shard, atomik rezerv, nonce, payout, rent/receipt; yerel Anchor/SBF uygulaması |
| Coinflip | `programs/games/` | Scoped VRF request/callback, house CPI, ödüllü kabul; gerçek sağlayıcı/recovery kabulü açık |
| Ödüller | `programs/incentives/` | Önceden fonlanan phase, saatlik claim, staking; anapara/ödül ayrımı |
| Zincir istemcisi | `packages/onchain/` | Üretilen IDL, hesap/işlem kodlama, PDA, simulation, devnet kontrolü ve işlem takip |
| Oyun protokolleri | `packages/protocol/` | Versiyonlu motorlar, LIVE zarfı, pool muhasebesi ve antrenman |
| Web | `apps/web/` | Next.js App Router, React, Wallet Standard, Three.js, ürün/oyun arayüzleri |
| Realtime | `apps/realtime/` | Cloudflare Workers + SQLite Durable Objects; native WebSocket, chat, shared turlar, snapshot/public tape |
| Kalıcı veri/kimlik | `supabase/` | Managed Postgres, SIWS/Auth, RLS, dar roller, indeks/outbox/migration/testler |
| Arka plan | `apps/worker/` | VPS Node indexer/keeper/outbox; finalized zincir kaydı; keeper key'i house authority değil |
| Dağıtım | `ops/`, `scripts/` | Systemd, paket SHA, sağlık doğrulaması, rollback, devnet planı, readiness |
| Araştırma | `experiments/` | PER, VRF recovery, connectome, self-play, fizik/motor, karar API'si, fanout yük deneyleri |

Stack sürümleri mevcut package/lock/kurulumdan: Node **24.21.0**, pnpm **10.18.2**, TypeScript **5.9.3**, Next **16.3.8**, React **19.3.0**, Three **0.186.1**, OpenNext Cloudflare **1.20.7**, Wrangler **4.145.0**, Playwright **1.63.0**, Supabase JS **2.117.2**, Wallet Standard app **1.1.1**. Rust toolchain **1.95.0**, Anchor **1.2.0**; SDK sürümlerini ilgili Cargo/lock dosyasından doğrula. “En yeni” diye kilitli bağımlılıkları topluca yükseltme.

SOLO/LIVE finansal durum, dövüş motoru ve render üç ayrı yetki alanıdır. Three.js bir sonuç/para otoritesi değildir. Next render döngüsü, kamera/FPS, gizlenen sekme veya reduced motion sonuca etki edemez. Antrenmanda yerel pause mümkündür; shared LIVE'da sunucu saati ve ledger geçerlidir.

## 5. Son tamamlanan iş: Combat Club

Ana dosyalar:

- `packages/protocol/src/combat-sparring.ts`, `packages/protocol/test/combat-sparring.test.ts`.
- `apps/web/components/boxing-sparring.tsx`, `boxing-sparring-scene.tsx`, `boxing-sparring-athletes.ts`, `boxing-sparring.module.css`.
- `apps/web/lib/sparring-controls.ts`, `sparring-camera.ts`; karşılık gelen `apps/web/tests/` testleri.
- `apps/web/tests/browser/ringside-sparring.spec.ts`.
- `scripts/boxing-assets/test-sparring-replay.mjs`, `sparring-replay.test.ts`, `combat-motion-v1.md`.
- `docs/research/ringside-sparring-20261003.md`; `ops/evidence/ringside-sparring-20261003.json` ve aynı adlı alt dizin.

Uygulanan: x/z hareket ve yön, sıçrama yerçekimi, stamina, jab/cross/hook/uppercut/roundhouse, hazırlık/aktif/toparlanma, input buffer, sınırlı hit-confirm combo, tekrar saldırı azaltımı, yönlü gard/chip/guardbreak, slip, hitstun, counter, knockback, aynı tick'te trade, KO, ring/kök ayrımı. Hasar aktif uzvun basitleştirilmiş baş/gövde hacmine süpürülmüş temasından gelir; bir saldırı bir kez hasar verir. Yakınlaşma/baskı/kontra botları **scripted**.

Klavye: WASD/oklar hareket, J jab, K direkt, L kroşe, U aparkat, R tekme, G gard, Q sıyrılma, Shift kaçış, Space sıçrama, Esc pause. Dokunmatik, odak kaybında tuş bırakma, fullscreen, ses tercihi, route/context-loss cleanup eklendi. Yayın/takip/üst kameraları iki karakteri korur; üst kamerada tavan kirişlerinin önüne geçmesi giderildi. 1280×720'de kontrolleri kaydırmadan erişme ve 390 px taşma testleri var.

Varlıklar: mevcut Quaternius 65 kemikli yetişkin model, FightKit kıyafetleri, CC0 Poly Haven haritaları; yeni CC0 Mesh2Motion 8 authored klibi ayrı `combat-motion-v1.glb` içinde. Yeni animasyon dosyası 357.712 byte, SHA `8ab9688e12a625ed3d4ec3c7ab752f4f465d90b33d3eef1580b276bc1e3cff39`. Jab/cross/hook authored; uppercut, tekme, sıçrama, temas IK ve ayak düzeltmeleri prosedürel katman içerir. Bunlar yeni mocap, AA karakter üretimi veya öğrenilmiş denge değildir. Modelin kemik uzunluğu uzatılarak erişim uydurulmaz.

Son kanıt kapsamı:

| Kayıt | Sonuç | Sınır |
|---|---|---|
| Web unit | 76 PASS | Sayısal kamera/input/adapter dahil; görsel kalite puanı değil |
| Protocol unit | 61 PASS | Yeni sparring mekanikleri dahil |
| Gerçek GLB rig | 10 PASS | CPU GLTFLoader/Mixer; yalnız image decoding stub; GPU/mesh fizik ispatı değil |
| Asset | 9 Python + 3 Three testi PASS | Lisans/hash/retarget/doğru klip bağlama |
| Tip/build | PASS | Son OpenNext build `yTTEY4MG5gmewPMEL9MsM` |
| Browser önceki build | 33/33 PASS | `5BsK4Lr38e6HYczgYrth8`: 6 yeni + 27 regresyon |
| Browser son build | 6/6 PASS | Son kamera değişikliğinden sonra etkilenen antrenman testleri yeniden koştu; 33 testin tamamı son build'de tekrar koştu denmez |
| Hosted görüntü | Gözlendi | `ops/evidence/ringside-sparring-20261003/hosted-final.jpg` |

28 gerçek motor isabetinde render uzvunun süpürmesi ilan edilen hurt-volume ile örtüştü. Bu üçgen mesh çarpışması, her pozda sıfır penetrasyon veya profesyonel dövüş kalitesi kanıtı değildir. Önceki render sayaç aralıkları terminal boşta durmayı içerdi: **aktif dövüş FPS sonucu INCONCLUSIVE**. Test sayısını kullanıcının görsel kabulünün yerine koyma.

## 6. Beyin, öğrenme ve fizik: gerçekler ve başarısızlıklar

| Çalışma | Gerçekte ne var? | Ne yok / açık sorun? |
|---|---|---|
| Connectome kaynak incelemesi | MaleCNS/FlyWire kaynak manifestleri, hash/schema/lisans/filtre; 128 gerçek nöron ve 4.949 kenarlı altgraf | Tam beynin işlevsel kopyası, bilinç, duyusal/motor biyolojik eşdeğerlik yok. Segment satırı, ağırlıklı sinaps ve Codex bağlantı adedi aynı şey değil |
| LIVE Contact v3 | Sentetik öğreticiyle eğitilmiş nonlinear imitation readout; bağımsız etikette yaklaşık %86,66 doğruluk | Bu oran gerçek dövüş kazanma ölçümü değil. Karıştırılmış graf benzer başarı verdi; connectome üstünlüğü gösterilmedi |
| Self-play / guarded | Gerçek simülasyon ödüllerinden ağırlık eğitimi ve ablation; 3.600 maç guarded aday | Eski teknik/enerji kapıları başarısız; model eski canlı sürüme otomatik aktarılmadı |
| Energy CEM6 | 26.640 ek eğitim maçı; final 576 maç/politika, 12 rakip, iki taraf | Teknik 3,602 ve motor müdahalesi %8,606 iyileşti; temiz isabet 10,880 < 12, toplam kalite **FAIL** |
| Tekme dengesi | Aynı bankada constant-kick %99,826, öğrenci %90,799 kazanıyor | Ortam sömürüsü çözülmedi. Final bankasında tekrar ayar yaparak sonucu şişirme |
| CMU + MuJoCo | Gerçek 4.800 fizik adımı, CMU13_18 mocap takip, sınırlı pelvis desteği | Takip p95 16,5 cm > 5 cm; penetrasyon 5,1 mm > 5 mm; destek ayağı p95 27,5 cm/sn > 10 cm/sn. **Üçü FAIL**; bağımsız öğrenilmiş denge değil |
| Bullet DeepMimic | Pretrained 197→1024→512→36 aktör, güvenli sayısal tensor yükleme, NumPy inference + PyBullet3.2.7 serbest taban | Yürüme/spinkick 10 sn, 240 Hz, 275 karar gözlendi. 1200 Hz yürüyüş 1,705 sn'de düştü. Robust dövüş/denge veya üç fizik eşiğinin birlikte geçilmesi yok |
| MimicKit/Newton | Kaynak/CPU deneyi; belirli SharePoint bağlantısında 401 ve temas adaptörü engeli | Bütün hazır motorların kullanılamaz olduğu anlamına gelmez. Sonraki Bullet başarısını eski “hiç inference yok” cümlesiyle silme |
| TypeSafe/Jev/Jeeves | `experiments/decision-agent/` içinde izole istemci/sözleşme/offline değerlendirme | Gerçek servis inference çağrısı yapılmadı. Bahis, ödeme, sonuç, transaction veya deployment yetkisi yok; tam beyin ve canlı kontrolcü diye tanıtılmaz |

**Üç ayrı kontrolcü:** canlı `connectome-policy.ts` imitation modeli; Lab'daki Energy6 self-play adayı; Combat Club scripted botları. Ayrıca ayrı düşük seviyeli pretrained fizik motoru var. Bunlar bugün birleşmiş bir zihin/beden değildir.

Frozen LIVE model SHA: `f8cd1d1feb8cf62f39eb2f1b11ebf95728deb8990f83594230d15709d2d9db9e`. Araştırma Energy6 SHA: `eb270b099c4c0d64bebc55f1d74ee06e92c6d24335370f501011ee6c7a8f5dee`. Eğitim maç içinde devam etmez. V3 recurrent state her rauntta sıfırlanır; sağlık/kondisyon taşınır.

Okunacak asıl kayıtlar: `experiments/connectome/LEARNING.md`, `experiments/combat-selfplay/{README,CURRICULUM,GUARDED,ENERGY}.md`, `experiments/combat-physics/README.md`, `experiments/combat-motor-reuse/{README,HISTORY}.md`, bunların manifest/evidence dosyaları ve `ops/evidence/ringside-quality-20261003.json`. History içindeki eski denemeler güncel manifestten ayrı değerlendirilir.

## 7. Finansal protokol ve gerçek varlık engelleri

Coinflip/House/incentives yerel SBF ve istemci uygulamaları vardır. Son kayıtta **ana House/Games/Incentives programları dağıtılmamıştır**; dağıtılan PER probe bunlardan ayrıdır. Root Coinflip provider request'i purge edildiğinde yerleşik güvenli recovery içermez; fon ve rezerv kilitli kalabilir. İzole aynı-proof recovery deneyi root programa entegre değildir. Yeni randomness veya sonuca göre iade, güvenli çözüm kabul edilmez.

`docs/devnet-deployment.md` kritik ön kontrolü: otomatik üretilen `target/deploy` House/Games keypair kimlikleri source/IDL ile uyuşmuyordu. **Kör `anchor deploy` çalıştırma.** Program kimliklerini, anahtarların sahipliğini, deployed-account beklentisini, rent/fee/funding planını ve IDL'yi önce uzlaştır. Önceki bakiye/ücret hesabı güncel değildir. Frontend/SDK devnet sınırlaması program binary'sinin içinde mainnet'i engelleyen bir cluster garantisi değildir.

`experiments/per/` kendi probe programının finalized devnet deployment'ını ve sınırlı TEE VRF/komut/reveal akışını gösterir. 292.384 byte ELF eşleşmesi, RPC kimliği veya sınırlı secret-byte taramasında eşleşme çıkmaması; attestation bağı, tam gizlilik veya L1 oyun ödemesi değildir. Önceki faucet engeli tarihsel olarak çözülmüştür; eski “2 SOL geldi” bilgisini güncel bakiye sayma.

Readiness'teki dokuz açık kapı:

1. `coinflip.same-proof-integration`: ilk input/key ve ortak consumed yolunun root bahis protokolüne güvenli entegrasyonu.
2. `coinflip.proof-availability`: oracle'ın sakladığı proof'un erişilebilirliği/liveness modeli.
3. `coinflip.recovery-license`: pinned BSL sağlayıcı/verifier üretim kullanım hakkı.
4. `coinflip.live-provider`: deploy edilmiş binary/kaynak eşdeğerliği, canlı callback, funded finalized payout.
5. `crash.attestation`: onaylı ölçüm ve quote→validator→program bağı.
6. `crash.privacy`: RPC/log/WS/queue/uçuş halindeki tüm yaşam döngüsünde gizli crash noktası.
7. `crash.manual-cashout`: sunucu/protokol kabul zamanı, sıralama, concurrency ve reconnect.
8. `crash.payment-recovery`: tam bir kez L1 ödeme hakkı ve kesinti kurtarması.
9. `launch.independent-review`: oyun/house audit'i, deployment kontrolleri ve operasyon açılış kararı.

Bu liste tüm ürün eksiklerinin listesi değildir; Ringside on-chain pooled vault, model yürütme kanıtı, görsel kalite, yük/telefon/işletme kabulü ayrıca gereklidir.

House modelinde kaybeden stake sözleşme kurallarıyla house'a gider. Kazananın brüt ödemesi escrow anaparasını aşarsa fark house rezervinden çıkar. 50/50 ve 1,96x brüt ödeme, maliyetlerden önce yaklaşık %2 beklenen house edge örneğidir; her tur kâr veya kesin işletme kârı değildir.

Mevcut ayrı receipt'lerde `extraReserve = max(maxGrossPayout - netEscrowStake, 0)`; bütün açık yükümlülükler toplanır. 1 SOL'ü shard'lara bölmek toplam teminatı çoğaltmaz. Henüz settle olmamış kaybeden receipt'lerini serbest house parası sayma. Crash rezervini anlık çarpandan değil kabul edilen maksimum ödemeden hesapla.

Ringside demo havuzlarında tamsayı per-pool conservation vardır: yatırılan toplam = kullanıcı ödemeleri + iadeler + açık ücret + ilan edilmiş yuvarlama kalanı. %2 havuz kesintisi ve tek taraflı havuz iadesi mevcut v2/v3 belgelerindedir. Tie/no-winner/cancel/cutoff/fee kuralları kabulden önce görünür olmalı ve exact uygulamadan doğrulanmalı. Farklı pazar/tur teminatını birbirine aktarma. Raunt bazlı dört pazar bütün maç sonucu veya kombine kupon değildir.

## 8. Altyapı ve ürünün diğer parçaları

Cloudflare web/realtime yayımlandı. Managed Supabase proje ref'i `lutwdmwkogtzajxvbuiy`; tarihsel kayıtta Frankfurt Free, Solana SIWS, RLS/ACL ve dar worker rolü doğrulandı. Native WebSocket/DO tercih edildi; sırf ilk kullanıcı mesajında Socket.io geçti diye sistemi Socket.io'a taşıma. Wallet bağlantısı ile SIWS session'ı farklıdır.

VPS erişimi `ssh sunucum`; tarihsel doğrulama Debian13/aarch64, 6 CPU, yaklaşık8GB RAM. `/opt/sollish/current` hashli release'e gider; `sollish-worker.service`, loopback `127.0.0.1:8790/health`, korunan `/etc/sollish/worker.env`. Managed DB doğrudan/session bağlantı ve advisory lock gerektirir; transaction pooler6543'e kör geçiş yapma. TLS doğrulaması kapatılmaz. Uygulanmış SQL migration'ını geriye dönük değiştirme; yeni migration ve kabul testi kullan. Kimlikte doğrulanmış SIWS/custom_claims kullanılır; kullanıcının değiştirebildiği user_metadata yetki kaynağı değildir.

MagicBlock PER'in Intel TDX güven modeli mevcut ARM VPS'te barındırılamaz. Uygulama işçisi ile gizli Crash yürütmesi ayrı sistemlerdir; Cloudflare Worker veya Supabase Edge Function'ı TEE yerine koyma.

Son belgelenen VPS durumu: servis çalışır, dar DB/TLS bağlantısı hazır; doğrulanmış Games deployment/hash ve house bilgisi eksik olduğundan indexer ve keeper kapalı. Gerçek finalized bahis indeksi oluşmadan “son bir saat minimum bahis” chat kabulü uçtan uca tamamlanmaz. `configured:false/ready:false` bir bekleme durumudur, canlı ödeme sistemi değildir. Güncel durumu iş başlamadan salt okunur doğrula.

Wallet yenileme düzeltmesi yapılmıştır: seçilmiş Wallet Standard cüzdana `silent:true` restore; açık disconnect tercihi siler, eski asenkron cevap yeni oturuma taşınmaz. Bütün gerçek uzantılarda destek garanti değildir. Yerel demo deadline/unmount/refund suistimali testleri var; tarayıcı sahibi DEMO belleğini değiştirebilir, bu para güvenliği sınırı değildir. Kaynak: `docs/wallet-demo-hardening.md`.

Saatlik ödül UTC epoch'undaki kabul edilmiş ödüllü bahisleri on-chain izler; chat kayan 60 dakikayı finalized indeksten hesaplar. Bunları aynı pencere sayma. Staking anaparası, kazanılmış token hakları ve house rezervi ayrı fonlardır. Pump.fun regular launch/Mayhem kapalı araştırma yönüdür; ücretsiz token tahsisi yoktur. %70 oyun/%15 staking/%10 airdrop/%5 topluluk önerisi **edinilmiş ödül rezervi** içindir, 1 milyar toplam arzın otomatik dağıtımı değildir. Launch henüz yapılmış sayılmaz.

Ölçek kanıtı: yerel workerd, tek finansal yazarlı fanout deneyi 1.000 izleyici+64 DEMO bahisçide tamamlandı; 1.120 bahisçi burst admission hedefi kaçtı, kabul edilen616 bilet korunup dağıtıldı. 4 Hz public delta deneyi trafiği %93,35 azalttı,20 kasıtlı sequence boşluğu snapshot ile kurtarıldı. Bu adaptörler otomatik hosted kapasite/ücretsiz plan garantisi değildir; canlıya taşımadan restart, hibernation, backpressure, privacy ve maliyet ölç.

</project_context>

<engineering_contract>

## 9. Devir boyunca koruyacağın kurallar

1. Önce kökte `AGENTS.md`, ardından `docs/product/ringside-neuroarena-spec.md` oku. Web değişikliğinde `apps/web/AGENTS.md` ve `apps/web/CLAUDE.md` ile kurulu `apps/web/node_modules/next/dist/docs/` rehberleri geçerlidir. Next API'lerini eski model bilgisinden varsayma.
2. Accepted ticket'ın motor/model/rule/ledger kimliği dondurulur. `ringside-contact-3-f8cd1d1f`, `ContactArena` ve `/v3/arena/ringside` eski biletler için korunur. V2 `/v2/arena/ringside` ayrı kalır. Zarfın `v:2` olması v3 motoru v2 yapmaz; `round.engine` ve `bout` alanını kontrol et.
3. Yeni öğrenilmiş motor veya dövüş davranışı yeni engine/policy hash'i ve uygun namespace alır. Eski biletleri kapatıp unutmak veya yalnız fail-closed yapmak settlement yerine geçmez. Hiç kabul edilmemiş yeni modda normal sürümleme ve yeniden kanıt üretimi uygundur.
4. Ajan yalnız izinli gözlenebilir mücadele verisini görür: rakip poz/mesafe/hamle sinyali, kendi enerji/sağlık ve geçmiş gözlemler. Bahisler, exposure, cüzdan bakiyesi, kasa kârı, gizli rakip politikası/gelecek seed ona verilmez. Tarafın house için kazanması yönünde karar değiştirilmez.
5. Seed/rule/model/engine commitment ve replay korunur. VRF yalnız seed'i doğrulasa bile modelin doğru yürütüldüğü ayrıca kanıtlanmalıdır. Önceden sonuç seçip animasyon oynatmayı özgürce düşünen/öğrenen beyin diye adlandırma.
6. Tüm finansal tutarlar tamsayı lamport/token birimiyle; overflow, rounding, nonce, duplicate, concurrency ve reserve kontrolleriyle hesaplanır. Yeni pazar bağımsız havuzdur. Guarantee-profit talebi sonuç manipülasyonuna çevrilemez.
7. Veri/asset/model kaynak URL'si, sürüm, lisans, hash, filtre ve sınırlama kaydedilir. Lisansı belirsiz ticari modeli, yetkisiz oyun asset'ini veya denetlenmemiş pickle kodunu çalıştırma. Authored klip, procedural katman ve mocap'i ayrı adlandır.
8. Önceki sohbette bir üçüncü taraf API anahtarı paylaşılmıştı. **Bu dosyada bulunmaz; sohbetten kopyalama.** Gerekirse sahibinin secret store'da yenilediği credential kullanılır. `.env`, wallet/keypair, DB parolası, OAuth token'ı, private session kimliği asset/URL/public tape/log/commit'e giremez. Public manifestleri yayından önce bu açıdan denetle.
9. Harici Jev/Typesafe/Jeeves karar modeli yalnız izinli veri/sınırlı şema döndürür. Key, deployment, shell, tool çağrısı, bahis açma veya para aktarımı yetkisi alamaz. Erişim sağlamadan kullanılmış gibi raporlama.
10. Devralan modelde Codex'in MCP/browser yetkileri varmış gibi davranma. Bağlı Cloudflare/Supabase MCP'lerini önce keşfet; mevcut CLI'yı gerektiğinde kullan. Browser oturumu gerekiyorsa kullanıcı Brave'de girişli olduğunu söylemişti; yeni OAuth yetkisini geçmiş giriş onayıyla karıştırma.
11. Eski VPS temizliği **tamamlanmış tarihsel tek seferlik işlemdir**; tekrar silme emri değildir. Varsayılan işlem koruma, sınırlı değişiklik ve geri dönüştür.
12. Kod/test/hash/runtime/hosted/CI/mainnet kanıtlarını ayrı raporla. Test sayısı, bir screenshot veya başarılı deploy “tamamlandı” yerine geçmez. Eski FAIL kayıtlarını ve eşikleri koru. Çalıştırılmayan testi çalışmış gösterme.
13. Mevcut stack'i gereksiz yeniden yazma; lisanslı uygun motor/asset/library'yi yeniden kullan. Ancak kaynak yetersizse salt CSS/IK ekleyerek temel sınıra takılmayı sürdürme; alternatifin maliyet ve uyumluluğunu küçük, ölçülebilir bir dilimde kanıtla.
14. Sırf bu dosya tamamlandı diye oyun geliştirmesi tamamlanmış değildir. Kullanıcının kalite eleştirisini aktif kabul açığı olarak taşı.

</engineering_contract>

<execution_orders>

## 10. Uygulama sırası ve somut teslimler

### P0 — çalışma durumunu güvenle devral

- `pwd`, Git durumu, ilgili talimatlar, son manifest ve SHA'ları kontrol et. Untracked dosyaları koru; secret taramasından önce `git add .` yapma. Gerekli dosyaları koruyan bir yerel checkpoint/versioning planı oluştur.
- Son sürümü yerel üretim runtime'ında başlat; `/live/ringside`, `/lab/ringside`, `/lab/ringside/play` ayrımını bizzat gör. Kullanıcı şikâyetlerini yeniden üret: temasın beden içinden geçmesi, geri çekilerek dövüşün bitmesi, tekme sömürüsü, zayıf ağırlık aktarımı ve dar kamera.
- Referans Fight Arena Online ve Punchers'ı mevcut araçlarla gerçekten oynayabildiğin ölçüde incele. Önceki denemeler tutorial/pause ve animasyonlu menüyle sınırlıydı; tam maç veya eşdeğerlik kanıtı yok. Girdi→hazırlık→temas→tepki→toparlanma, enerji, mesafe, kamera ve tempo için karşılaştırma kaydı çıkar. Giremediğin oyunu oynadığını iddia etme.
- İlk değişikliğin kabul senaryosunu seç; mevcut başarısızlığı kaydet, kök nedeni belirle, uygula ve aynı senaryoda karşılaştır. Yalnız uzun mimari rapor yazıp bitirme.

### P1 — Ringside dövüşünün kalite açığını kapat

- İlk hedef tek bir kaliteli düello: tutarlı yaklaşma/menzil, gövde/kalça/ayak ağırlık aktarımı, gard/kaçınma/kontra, doğru temas ve okunur darbe tepkisi. İki karakterin sürekli birbirinden kaçmasını veya sırayla sabit animasyon oynamasını kabul etme.
- Teknikleri kurala göre tanımla: boks ve kickboxing/Muay Thai karma kurallarını rastgele karıştırma. Mevcut beş tekniği güvenilir kıl; yeni elbow/knee/grapple/ground tekniğini yalnız uygun rig/clip/temas/kurallar ve testle ekle.
- Mesh/iskelet ölçüleri, baş-gövde-kol-bacak hurt volume'ları, eldiven/ayak swept hit volume'ları ve hakem/karakter konumlarını birlikte doğrula. Hasar anatomik hedef/hamle/enerji/gard ile tutarlı olsun; animasyon sonucu uydurmasın. Root collision testi, tüm beden çarpışma testi sayılmaz.
- AA seviyesinde karakter ve animasyon paketi araştır/karşılaştır: lisans, ticari web dağıtımı, rig uyumu, clip kapsamı, geçişler, mobile LOD/texture/memory/bundle maliyeti. Gerçek asset/animasyon kalitesi gerekiyorsa bunu görünür eksik olarak çöz. Ücretli pakete ihtiyaç varsa aday+lisans+fiyat+kapsamı somutlaştır; satın alma yapma.
- Kamera: yakınlığı ve iki karakterin tam gövdesini dengeler; ring köşesinde, sıçramada, KO/yere düşmede ve mobil oranda kesmez; halat/tavan/hakem görüşü bozmaz. Gereksiz kamera sarsıntısını azalt; reduced motion alternatifi olsun.
- Arena/ışık/PBR/seyirci/hakem işini salt daha çok obje eklemek diye ele alma. Sahne okunurluğu, karakter silueti, ayak-gölge teması, ışık tutarlılığı ve oynanış ritmi üzerinden değerlendir. Hakem üstüne dövüşçü bindirme.
- Aktif dövüşün FPS/frame-time/memory/GPU ölçümünü geçerli bir zaman aralığında yap; KO sonrası idle'ı ölçüme katma. Masaüstü ve mobil emülasyonu ayrı kaydet; kaynak temizliğini tekrar giriş/çıkışta kontrol et.

### P2 — öğrenilmiş strateji ile bağımsız beden kontrolünü birleştir

- Önce yeni ve sürümlü araştırma ortamında tekme sömürüsünü çöz. Eski LIVE davranışını değiştirme. Guard, range/recovery, enerji, düşük saldırı savunması ve teknik risk/ödülünü gerçek rollout'larla ölç.
- Öğrenilmiş aday için train/validation/final seed ve rakiplerini baştan ayır; final açıldıktan sonra tuning yapma. Random/scripted/constant-action, eski öğrenilmiş ve graph-shuffled/no-recurrence ablation'ları koru. Kazanma oranına ek temiz temas, teknik çeşitliliği, enerji önerileri, müdahale, temassız süre ve kötü örnekleri raporla.
- Üst düzey perception/history→tactics ve düşük düzey hareket/denge/contact kontrol arayüzünü tanımla. Eski öğrenilmiş sekiz aksiyon ile sparring'in beş saldırı+jump/dash kontrol alanı aynı değil; Energy6 ağırlıklarını doğrudan bağlama. “Beyin” sözcüğünü sensor→memory→decision→action→reward/evaluation çalışan zinciriyle destekle. Anatomiyi yüklemek veya if/else bot yazmak öğrenme değildir.
- Hazır DeepMimic/MimicKit veya uygun lisanslı alternatifi gerçek fizik ortamında değerlendir. Pretrained walk/spinkick başarısını bağımsız iki kişilik combat, knockback recovery veya motor yeniden eğitimi diye sayma. Gözlem/action/skeleton/frequency eşleştirmesini test et.
- Var olan üç fizik kapısını aynı koşuda karşıla: tracking p95 ≤5 cm, penetrasyon ≤5 mm, destek ayağı p95 yatay hız ≤10 cm/sn. Pelvis desteğini gizleme; bağımsız denge için desteğin olmadığı başlangıç/darbe/itme/fall/recovery ve görülmemiş geçiş koşullarını ekle. Eşikleri düşürerek PASS üretme.
- Yeni engine/policy/body/asset paketini freeze et, replay ve sonuç eşdeğerliğini doğrula; eski accepted ticket'lara dokunmadan sürümlü araştırma→demo terfisi yap. Tam fruit-fly beyni/bilinç veya biyolojik düşünme iddiası ancak buna uygun bilimsel kanıtla mümkündür; bugün yoktur.

### P3 — kaliteli shared LIVE ve izleme deneyimi

- Her raunt için önceden ilan edilmiş admission cutoff, bağımsız market pool, accepted/locked/settled/refunded durumları ve public replay kaydı olsun. Yeni oyun başlangıcında bahis kapanmalı; tarayıcı saatini otorite sayma.
- Çevrimiçi **oturum**, benzersiz katılımcı, bilet sayısı, toplam tutar ve seçenek hacimlerini birbirinden ayır. Gerçek ölçülmeyen sayıyı uydurma. Anonim public tape'te özel session/auth kimliği gösterme.
- Dövüşçüye tıklama ve klavye eşdeğeri bahis seçimini yapabilsin. Desktopta sahne+saat+sağlık/enerji+canlı defter+bahis formu aynı çalışma alanında; mobilde kritik bilgi görünürken defter/chat paneli erişilebilir olsun.
- Finansal tek yazarı koruyarak fanout/delta/snapshot, reconnect, hibernation/restart, duplicate/out-of-order, backpressure ve kapasiteyi doğrula. Kontrolsüz worker/shard çoğaltma aynı parayı iki kez harcatmamalı.
- Yeni pazarlar önce olay tanımı ve oracle/engine sonucu: örneğin raunt kazananı, ilk geçerli temas, belirli teknik/knockdown eşiği. Belirsiz animasyon veya hakem görüntüsünden settlement türetme. Çoklu pazar otomatik cross-market collateral veya kombine kupon değildir.

### P4 — gerçek finansal ürün ve operasyon

- Coinflip root recovery/lisans/provider kapılarını; zorunlu manuel Crash privacy/attestation/order/payment-recovery kapılarını ilgili deneylerden devam ettir. Kendi kriptografini uydurma. Provider audit'i Sollish audit'i değildir.
- Ringside gerçek varlıklar için ayrı on-chain pooled vault/admission/claim/refund/fee programı ve frozen motor yürütme doğrulaması gerekir; mevcut fixed-odds House reserve kuralını gevşeterek bunu taklit etme.
- Devnet deployment, finalized payout, house rezervi, keeper journal/retry, indexer/outbox, SIWS ve uygun/uygun olmayan chat cüzdanlarını gerçek uçtan uca sınayarak tamamla. Belirsiz tx için yeni blockhash ile kör yeniden imzalama yerine kalıcı journal ve finalized hesapları uzlaştır. UI bayrağını açmak entegrasyon değildir.
- Token mint/authority/extension, fonlanmış phase, saatlik tek claim, stake/unstake, geciken epoch ve ödül yükümlülüğünü test et. House teminatı ve staking anaparası buyback bütçesi değildir.
- Worker/Supabase/Cloudflare log-ölçüm-alarm, yedek/geri yükleme, rollback, bağımlılık/gizli bilgi güvenliği, yük ve maliyet kabulünü kaydet. Plan yükseltmesini ölçülen gereksinim ve bütçeyle öner.
- Audit, sağlayıcı/ülke/işletme koşulları ve ayrı mainnet kararı olmadan gerçek SOL kabul etme. Pump.fun launch/likidite/marketing daha sonra, gerçek token bütçesi ve güncel resmî süreçlerle yapılır; garanti kazanç pazarlaması yapma.

P1/P2 önceliklidir çünkü kullanıcının son somut itirazı oyun kalitesidir. Bir dış kaynak P2'yi engellerse erişilebilir P1/P3/P4 işlerini sürdür; yeni prototip rotaları açmayı teslim yerine koyma. Sadece “sonraki adım şu” diyerek yapılabilir işi bırakma.

</execution_orders>

<acceptance_and_workflow>

## 11. Çalışma biçimi ve kabul

- Kullanıcıyla Türkçe, kısa ve somut konuş. Başta hedefi, çalışma sırasında bulguyu, sonunda değişikliği+kanıtı+gerçek sınırı açıkla. “Mükemmel/AAA/kusursuz/tam beyin” etiketi yerine ölçüm ve oynanış kanıtı ver.
- Bağımsız araştırma/test/review işlerini erişilebilir alt ajanlara ayır; aynı dosyanın iki yazarı olmasın. Sonuçlarını ana ajan doğrulasın. Yerel M2/8GB üzerinde build, fizik eğitimi ve tarayıcıyı kaynak tüketimi gözetmeden paralel çalıştırma.
- Her iş için **problem → başarısız yeniden üretim → değişiklik → uygun test → gerçek sahne → sürüm/evidence** zinciri kur. Başarılı kontrolleri yeni sebep yokken sonsuz tekrar etme. Sonuç uymadığında testi gevşetmek yerine kök nedeni çöz.
- Kaynak branch/commit yoksa SHA256 kullan; yeni Git düzenini secret'ları ve mevcut untracked dosyaları koruyarak kur. Çalışma ağacını temizlemek için silme yapma.
- Tasarım yönü: oyunun kendisini öne alan yayın ekranı; okunaklı sabit genişlikli rakamlar, az sayıda anlamlı vurgu, açık durumlar. Eş kart duvarları, süs gradientleri, neon glow, cam efekti yığını, oversized hero metni ve sahte işlem/oyuncu akışı ekleme. Mevcut marka ve `docs/design-brief.md` ile tutarlı çalış; gerekli sahne iyileştirmesini genel landing page'e çevirme.
- Görsel kabul hareket halinde yapılır: farklı mesafe/açı/tempo, gard, combo, miss, hit, knockdown, köşe, pause/reconnect ve dar ekran. Screenshot'a ek kısa kayıt veya tekrarlanabilir replay kullan. Kullanıcının kalite kabulü hâlâ açık olduğu sürece “nihai kalite tamamlandı” yazma.
- Ürün kontrolleri 320/390/768/1440 px; desktop1280×720 dahil kritik kontroller kaydırmasız; 44–48 CSS px dokunma hedefi; keyboard/focus/reduced motion/context-loss. Fiziksel telefon ayrı pending.
- Yeni sonuç/finans motoruna camera, FPS, ağ kopması, fanout, client clock, duplicate ve kötü sırada olay testleri ekle. Train/test sızıntısı, action masking, gizli motor müdahalesi ve seed seçimi öğrenme değerlendirmesinde açık olsun.
- Çalışma tamamlandığında çalışan process/alt ajan sonuçlarını bekle; yalnız background başlatmış olmayı teslim sayma. Gerçek engelde denenen yolu, hata/kanıtı ve bağımsız devam edebilecek işleri yaz.
- Context dolmadan bu dosyanın sonundaki devam kaydını güncelle. Güncel hedef, dosyalar, kararlar, fail/pass, source/build/version, çalışan süreç ve tam sonraki komut kalsın. Yeni sohbet aynı klasörde buradan başlasın; önceki başarı ve hataları uydurma. Otomasyon varsa aynı dış engeli sonsuz denemek yerine birkaç değişmeyen denemeden sonra açıkça durdur.

Örnek kabul dili:

| Hatalı sonuç | Doğru ayrım |
|---|---|
| “76 test geçti, oyun artık AAA.” | “76 unit geçti; şu hareket/temas senaryosu gerçek sahnede düzeldi. Karakter/mocap kalite kabulü açık.” |
| “Sineğin beynini aktardık.” | “Kaynağı belli128 nöron altgrafında readout eğitildi; varsayımsal dinamik, sınırlı evaluation, biyolojik eşdeğerlik yok.” |
| “Kasa hep kazanıyor.” | “Bu havuz yatırılan fonun dışına ödeme yükümlülüğü üretmiyor; ücret geliri işletme kârı garantisi değil.” |
| “Cloudflare deploy geçti, ödeme hazır.” | “Web sürümü yayımlandı; funded finalized payout ve oracle/privacy kapıları ayrı açık.” |

## 12. Çalıştırılabilir komutlar ve araç sınırları

Bütün komutları repo kökünde çalıştır. Önce script'i ve ortamını kontrol et. `.tooling` yeniden üretilebilir runtime/cache içerir; bazı deney indirmeleri/model ağırlıkları ignored olduğundan başka makinede mevcut olmayabilir. Secret dosyalarını proje transferine dahil etme; ayrı güvenli provisioning kullan.

```sh
cd /Users/macmini/Desktop/Sollish
pwd
git status --short
bash scripts/use-node.sh node --version
bash scripts/use-node.sh pnpm --version
bash scripts/use-node.sh pnpm install --frozen-lockfile
```

Node wrapper resmî SHA doğrulamasıyla proje içine Node24.21.0 kullanır; sistem PATH'ini değiştirme. Yükleme zaten tamamsa gereksiz reinstall yapma. Next dev3000; gerçek Cloudflare/workerd önizleme varsayılan3001:

```sh
bash scripts/use-node.sh pnpm dev
# Ayrı terminal: üretim runtime'ı gerektiğinde
bash scripts/use-node.sh pnpm --filter @sollish/web build:cloudflare
bash scripts/use-node.sh pnpm --filter @sollish/web preview:cloudflare
```

İlgili değişiklik için temel doğrulama:

```sh
bash scripts/use-node.sh pnpm --filter @sollish/protocol test
bash scripts/use-node.sh pnpm --filter @sollish/web test
bash scripts/use-node.sh pnpm --filter @sollish/web typecheck
bash scripts/use-node.sh node scripts/boxing-assets/test-sparring-replay.mjs
python3 scripts/boxing-assets/test_assets.py
python3 scripts/boxing-assets/test_combat_motion.py
bash scripts/use-node.sh node --test scripts/boxing-assets/combat-motion.test.mjs
```

Çalışan3001 üretim preview'a hedefli browser testi; varsayılan test komutu yoksa dev sunucusu açar, kapsamı yanlış etiketleme:

```sh
PLAYWRIGHT_SKIP_WEBSERVER=true PLAYWRIGHT_BASE_URL=http://localhost:3001 \
  bash scripts/use-node.sh pnpm --filter @sollish/web test:browser ringside-sparring.spec.ts --workers=1
```

LIVE/backend/protokol değiştiğinde ilgili kapsam:

```sh
bash scripts/use-node.sh pnpm --filter @sollish/realtime test:contact
bash scripts/use-node.sh pnpm --filter @sollish/realtime test:ringside
bash scripts/use-node.sh pnpm --filter @sollish/realtime test:arena
bash scripts/use-node.sh pnpm --filter @sollish/realtime test:integration
bash scripts/use-node.sh pnpm test:database
bash scripts/use-node.sh pnpm build:worker
bash scripts/use-node.sh pnpm test:worker-bundle
bash scripts/use-node.sh pnpm test:operations
bash scripts/use-node.sh pnpm idl:check
bash scripts/test-contracts.sh
bash scripts/use-node.sh pnpm check:readiness
```

`test:database` yalnız kendi loopback test kümesini kullanır; hosted DB resetleme. Rust/SBF gerekirse `scripts/toolchain-setup.sh` ve `docs/validation.md` oku. `check:readiness` exit2 bilinen açık kapılar, exit1 eksik/değişmiş kanıt; bunları otomatik PASS'e çevirecek bayrak ekleme. PER ayrı npm projesi; `experiments/per/test/README.md` saf fixture testini gerçek ELF/artifact testinden ayırır. Öğrenme/fizik komutları ilgili README ve venv'lerden alınır; eski training runner'ları aynı output dizinine yazar, tarihsel kanıtın üzerine çalıştırma.

Devnet web değişikliği hazır ve kapsam içinde olduğunda mevcut Cloudflare MCP/CLI yolu:

```sh
bash scripts/use-node.sh pnpm --filter @sollish/web build:cloudflare
bash scripts/use-node.sh pnpm --filter @sollish/web exec wrangler deploy
```

Deploy komutunu yalnız ilgili değişiklikte çalıştır; bu devir metnini okuman deployment sebebi değildir. Web public env build zamanında gömülür. Realtime deployment ayrı ve eski DO namespace/biletleri korumalıdır. Multiword `--message` OpenNext forwarding yolunda önceki koşuda bozuldu; gerekirse tek token kullan. CLI HTTP403 kontrolünü başarılı sayma veya bypass etme; meşru MCP/tarayıcı gözlemini ayrı kaydet. VPS read-only başlangıç `ssh sunucum 'systemctl is-active sollish-worker.service'`; health ve dar log incelemesinde secret dökme.

</acceptance_and_workflow>

<reference_map>

## 13. Dosya ve araştırma kaynakları

**Önce oku:** `AGENTS.md` → `docs/product/ringside-neuroarena-spec.md` → `docs/validation.md` son bölümleri → `ops/evidence/ringside-sparring-20261003.json`. Web için alt talimatları ekle. Bütün repoyu tek seferde context'e doldurmak yerine iş paketinin kaynaklarını aç.

- Platform: `README.md`, `docs/architecture.md`, `docs/contracts.md`, `docs/coinflip.md`, `docs/incentives-contracts.md`, `docs/original-games.md`.
- LIVE/ekonomi: `docs/architecture/live-rounds-and-house.md`, `docs/releases/ringside-contact-2026-10-03.md`, `packages/protocol/src/pari-mutuel.ts`, `apps/realtime/src/ringside-arena.ts`.
- Servisler: `docs/backend.md`, `docs/hosting.md`, `docs/operations.md`, `docs/scaling.md`, `docs/load-validation.md`, `docs/devnet-deployment.md`.
- Tasarım/istemci: `docs/design-brief.md`, `docs/wallet-demo-hardening.md`, `docs/research/ringside-sparring-20261003.md`, `apps/web/lib/public-config.ts`.
- Asset: `scripts/boxing-assets/{README,combat-motion-v1}.md`, `apps/web/public/models/boxing/credits.json`, ilgili LICENSE/NOTICE dosyaları; `experiments/visual-assets/README.md`.
- Kanıt: `ops/evidence/ringside-{contact,research,quality,sparring}-20261003.json`; her birinin kapsamı farklıdır. `.github` workflow tanımı remote CI çalıştığını kanıtlamaz.

Kullanıcının önemli referansları:

- [Fight Arena Online](https://www.crazygames.com/tr/game/fight-arena-online), [boxing koleksiyonu](https://www.crazygames.com/tr/t/boxing), [Punchers](https://www.crazygames.com/tr/game/punchers).
- [Google Research — complete male fruit-fly brain](https://research.google/blog/a-connectomics-milestone-mapping-the-complete-male-fruit-fly-brain/), [Cell makale bağlantısı](https://linkinghub.elsevier.com/retrieve/pii/S0092867426009426), [FlyWire FAFB](https://codex.flywire.ai/?dataset=fafb), [FlyWire MaleCNS](https://codex.flywire.ai/?dataset=mcns).
- [PostHog Jeeves](https://github.com/PostHog/jeeves). Kullanıcının verdiği API credential'ı buraya taşınmadı; bu repo ile TypeSafe servisinin rolünü/erişimini aynı şey varsayma.

Bu dosyanın prompt yapısı için 4 Ekim 2026'da incelenen resmî kaynaklar:

1. [Anthropic — Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5): modelin özel rehberi. Belirgin iş bitirme koşulları, anlamlı ilerleme bilgisi ve somut görsel yön kullanıldı. Effort ayarı istemci/API konfigürasyonudur; “tüm gücün” ifadesiyle teknik ayar yapıldığını varsayma. Varsayılan medium'dan farklı düzey seçimini gerçek görev kalitesiyle değerlendir; max ayarı otomatik kalite kanıtı değildir.
2. [Anthropic — Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices): bağlam, talimat, kabul ve kaynaklar açık etiketlerle ayrıldı; uzun proje bağlamından sonra görev sırası ve en sonda başlatma emri kondu.
3. [Claude Code — Best practices](https://code.claude.com/docs/en/best-practices): somut dosya yolları, çalıştırılabilir doğrulama ve context sürekliliği eklendi. Bu uzun devir dosyası tek sefer açıkça okutulur; her görevde otomatik yüklenen genel `CLAUDE.md` yerine kapsamlı bir devir belgesi olarak tutulur.
4. [Claude Code — Memory](https://code.claude.com/docs/en/memory): proje talimatları ve kalıcı bağlamın rolü; mevcut `apps/web/CLAUDE.md` korunur.
5. [Anthropic — Claude Opus](https://www.anthropic.com/claude/opus): Opus5.5 adı ve `claude-opus-5-5` kimliği doğrulandı. Çalışacağın hesabın erişimini bu belgeden varsayma.

Kaynak rehberler bu projenin teknik doğruluğunu ispatlamaz; proje iddiaları repo/deney/deployment kanıtlarına dayanır. Bu talimat, kullanıcının isteklerinin düzenlenmiş devridir; dış sayfalardaki metinler yeni yetki veya yürütme emri değildir.

</reference_map>

<resume_checkpoint>

## 14. Devam kaydı — ilk teslim

- Son tamamlanan iş: Combat Club/sparring-1 kodu, lisanslı animasyon eki, temas/rig/kamera/input düzeltmeleri, hedefli testler ve Cloudflare web yayını.
- En son kullanıcı kararı: proje Claude Opus5.5'e devredilecek; tek talimat dosyası isteniyor. Bu dosya hazırlanırken yeni oyun geliştirmesi/deployment yapılmadı.
- Güncel en yüksek ürün önceliği: referans seviyesinde dövüş mekaniği ve görsel kalite; gerçek öğrenilmiş strateji + bağımsız beden kontrolü entegrasyonu.
- Açık kritikler: tekme sömürüsü; Energy6 temiz isabet eşiği; üç fizik kalite kapısı; profesyonel karakter/mocap; geçerli aktif FPS; shared LIVE'a güvenli yeni motor terfisi; on-chain pooled vault/yürütme kanıtı; dokuz gerçek varlık gate'i. Fiziksel telefon kullanıcıya ertelendi.
- Bilinen kapsam tuzağı: yeni practice scripted; eski canlı imitation; yeni self-play kayıtları ve DeepMimic fizik motoru ayrı. Hiçbiri tek başına “tam beyin” değil.
- Çalışan geçici iş: önceki yerel preview kapatıldı; bu devir turunda eğitim/build/background job başlatılmadı. Yeni oturumda process ve portları yeniden kontrol et.
- İlk işlem: aşağıdaki başlatma emrini uygula; P0 doğrulamasından sonra P1'in ilk ölçülebilir dövüş düzeltmesine geç. Kodu sıfırdan yeniden yazma, tarihsel başarısız kayıtları koru.


### Devam kaydı — 4 Ekim 2026, Claude Opus 5.5 ilk oturumu

- **Yapılan:** Combat Club `sparring-1` → `sparring-2` (yalnız bahissiz `/lab/ringside/play`). Uzuv temas yüzeyinde durur ve geri çekilir; yönlü ayak hızı + vuruş adımı; blok maliyeti/yenilenme dengesi; hasar/tempo ayarı; botlar cezalandırma ve dayanıklılık rezervi (hâlâ scripted). Sunum: kroşe gövde rotasyonu, ölçülmüş deri sınırı, alçak/yakın kamera, 3/4 takip kamerası, halat kesiti, araç çubuğu başlığa taşındı (sahne 370→468 px).
- **Kanıt:** `experiments/combat-sparring-audit/` (README, dondurulmuş sparring-1 kopyası, denetim/yakalama betikleri, ayar + görülmemiş seed sonuçları); `ops/evidence/ringside-sparring2-20261004.json` + aynı adlı görüntü dizini; `docs/validation.md` ve spec'in 4 Ekim bölümleri.
- **Test:** protocol 65/65, web 76/76, typecheck, GLB 10/10, asset testleri, tam tarayıcı 77/77 (build `58nJGPuyJ2rBqjbkcA3_N`, yerel workerd). M2 Metal aktif dövüş ~60 FPS ort. Readiness BLOCKED/exit 2.
- **Yayımlanmadı.** Hosted web hâlâ sparring-1 (`93645ad3-…`). Kullanıcı isterse: `bash scripts/use-node.sh pnpm --filter @sollish/web build:cloudflare && bash scripts/use-node.sh pnpm --filter @sollish/web exec wrangler deploy`, ardından MCP ile aktif sürüm doğrulaması ve hosted hareket kaydı.
- **Git:** HEAD hâlâ yok, commit yapılmadı. Basit desen taraması 745 aday dosyada yalnız örnek/test yer tutucusu buldu; ilk commit'ten önce uygun bir secret tarayıcısı (ör. gitleaks) yine önerilir.
- **Açık:** kullanıcı görsel/his kabulü; insan oyun testi; karakter/animasyon sanat kalitesi (AA/mocap adayı araştırması yapılmadı); self-play tekme sömürüsü, Energy6 temiz isabet kapısı, üç fizik kapısı; öğrenilmiş strateji + beden entegrasyonu; P3/P4 kalemleri; fiziksel telefon.
- **Sonraki adım önerisi:** sparring-2'yi yayımlamak (kullanıcı onayıyla) ve kullanıcı oyun hissini değerlendirirken P1 karakter/animasyon paketi karşılaştırmasına (lisans/fiyat/rig/LOD) geçmek.

### Devam kaydı — 4 Ekim 2026 (2): izleme sürümü, mocap, arena, ses

- **Kullanıcı kararı:** "Kendin oyna" hiçbir oyunda olmayacak; ürünler yalnız izleme + bahis. Görsel/mekanik kalite "en premium" seviyede istendi; meyve sineği öğrenme sisteminin de çalışması istendi.
- **Yapılan:** `sparring-3` (boks kuralı: tekme reddedilir, 0,78 m gövde mesafesi, gerçekçi ayak hızları, ring kesen botlar); CMU boks mocap pipeline'ı (`scripts/boxing-assets/cmu/`) → `cmu-boxing-v1.glb` (8 jab, 8 direkt, 4 kroşe, 58 ayak oyunu); `boxing-mocap-athletes.ts` (saf fonksiyon blend-space + zaman-eşlemeli yumruk + göğüs uzanma desteği + temas IK); `boxing-arena.ts` (özgün arena, uyarlanabilir kalite); `lib/ringside-audio.ts` + `public/audio/ringside/` (CC0 yumruk, CC BY 4.0 seyirci, sentez zil); UI yalnız izleme.
- **Kanıt:** `ops/evidence/ringside-sparring3-20261004.json` + görüntü dizini; denetim `experiments/combat-sparring-audit/evidence/sparring3-*`; build `1JyknQCgc_sUVus5smcSg`; tarayıcı 77/77, GLB 10+10, protocol 67, web 76. **Yayımlanmadı.**
- **Açık / sıradaki:** (1) Mixamo (Adobe girişi kullanıcıda) ile aparkat, darbe tepkisi, nakavt, kalkma, zafer klipleri — kullanıcıdan indirme isteniyor; (2) nakavt sayımı + raunt yapısı + kamera rejisi (KO yakın plan, ara çekimler); (3) karakter sanatı (Quaternius low-poly; ücretsiz/lisanslı daha iyi insan modeli araştırması); (4) foot-lock; (5) öğrenilmiş politika (yeni eylem alanı için yeniden eğitim, connectome readout'u); (6) bahisli LIVE'a yeni namespace ile terfi.
- `apps/web/lib/sparring-controls.ts` + testi artık ürün tarafından kullanılmıyor; silme kararı kullanıcıda (git geçmişi yok).
- Çalışan: yerel önizleme `http://localhost:3001/lab/ringside/play` (son build).

### Devam kaydı — 4 Ekim 2026 (3): `sparring-4` ve Mixamo hazırlığı

- Kullanıcı Mixamo'ya Safari'de giriş yaptı, Brave'de de mixamo.com sekmesi açık; modelleri/animasyonları sıfırdan yeniden tasarlama izni verdi.
- Engel: Safari/Brave "Apple Events'ten JavaScript'e izin ver" kapalı. Açılınca: `scripts/boxing-assets/mixamo/export-in-page.js` mixamo sekmesinde çalıştırılır (token sayfada kalır), dönen imzalı FBX URL'leri `.tooling/mixamo/`'ya indirilir, FBXLoader→retarget→GLB pipeline'ı (CMU ile aynı yaklaşım) uygulanır. İstenen klipler: Uppercut, Hook Punch, Head Hit, Stomach Hit, Knocked Down, Knocked Out, Getting Up, Victory, Bouncing Fight Idle; ayrıca Mixamo karakter adayları karşılaştırılacak.
- Yapılan: `sparring-4` (sersemleme knockdown, sayım, kalkma, 8 sayım, TKO, raunt/ara, 10-9 kart, karar, hakem, yerdeki bedenin etrafından dolaşma), otomatik kamera rejisi, raunt/knockdown sesleri, `?seed=` inceleme parametresi. Kanıt `ops/evidence/ringside-sparring4-20261004.json`; build `OGU2u_5wt9P6ZSKBu5mee`; tarayıcı 77/77. Yayımlanmadı.

### Devam kaydı — 4 Ekim 2026 (4): Mixamo, akıcılık, NeuroBoxer başlangıcı (kullanım limiti nedeniyle yarıda)

- Mixamo: Brave'deki oturumdan 43 animasyon indirildi (`.tooling/mixamo/fbx`, manifest SHA'lı); 27'si `apps/web/public/models/boxing/mixamo-boxing-v1.glb` (+ .json, -credits.json) olarak bake edildi. Pipeline: `scripts/boxing-assets/mixamo/`. Yeni renderer `apps/web/components/boxing-mixamo-athletes.ts` (varsayılan; `?renderer=cmu` eski). GLB testi `SPARRING_RENDERER=mixamo` 10/10.
- Akıcılık: sahnede `?probe=1` ölçümü, tick-arası ara-konum, 50 ms poz yumuşatma + 35 rad/s kemik hız sınırı, kesmesiz kamera. Ölçüm (seed 7): kamera sıçraması 4,6 m → <0,07 m/kare; kemik p99 162 → ~64 rad/s. Kalan yüksek değerler yumruk anında temas IK'si; video ile gözle kontrol edilmedi.
- Motor `sparring-4` güncellendi (yayımlanmadı): hazırlık +3 tick, adımlı yumruklar (jab .26 m), kalkma 162 tick (Mixamo klibiyle eş), yerdeki beden modeli. Protocol 71/71; tekrar denetim: runner 0,000, hit&run 0,08–0,20 (ayar seti; görülmemiş seed ve evidence dosyası bu son haliyle YENİLENMEDİ).
- NeuroBoxer: `packages/protocol/src/neuro-boxer.ts` (22 gözlem → 128 MaleCNS düğümü recurrent → hareket/gard/komut), `experiments/neuro-boxer/{graph.json,env.ts,worker.ts,train.ts}`. 10 nesil duman testi doğrulama skorunu 0,94'e çıkardı — ŞÜPHELİ (sömürü olabilir); uzun eğitim, shuffled/norecur ablation'ları, görülmemiş seed değerlendirmesi, sömürü probları, UI'da "sinek beyni" köşesi ve düşünme paneli YAPILMADI.
- Sıradaki komutlar: `bash scripts/use-node.sh node --import tsx experiments/neuro-boxer/train.ts connectome 300 1 5` (sonra shuffled, norecur); evaluate.ts yazılacak; tam build + 77 tarayıcı testi yeniden; evidence/validation güncellenecek.

### Devam kaydı — 4 Ekim 2026 (5): NeuroBoxer tamamlandı, Mixamo + akıcılık doğrulandı

- NeuroBoxer: 3 mimari × 3 seed, eşzamanlı kararla yeniden eğitildi (eski sıralı-karar koşuları `experiments/neuro-boxer/runs-staggered/`). Held-out: öğrenme var (botlara ~0,97–1,00, taban ~0); bağlantı haritası üstünlüğü YOK. Ürün modeli connectome seed 1 (doğrulamayla seçildi), seed'e bağlı örnekleme T=0,8, varsayılan maç sinek beyni vs sinek beyni (600 maçta KOR 0,505). Düşünme paneli `neuro-thinking-panel.tsx`.
- Kanıt: `ops/evidence/ringside-neuro-20261004.json`, `experiments/neuro-boxer/{README.md,evidence-heldout.json}`. Build `FKpFLGsfHJMj3vu0V220b`. Tam tarayıcı paketi 77 geçti + 1 eski varsayım; düzeltilen spec 7/7. Yayımlanmadı.
- Sıradaki: daha güçlü rakip havuzu ile mimari karşılaştırması; teknik çeşitliliği (jab/direkt ağırlıklı); karakter modeli; bahisli LIVE namespace'e terfi; kullanıcı görsel kabulü.

### Devam kaydı — 4 Ekim 2026 (6): kullanıcının son talepleri ve yeni oturum planı

Kullanıcı (bu oturumun bağlamı doldu) kalan işlerin **yeni bir Opus 5.5 UltraCode oturumunda paralel ajanlarla** yapılmasını istedi. Son talepler:
1. **Maç içi karakter:** iki sinek beyni boksör yalnız hamle değil, maçın gidişatına göre karakter de seçmeli (kontra, baskın, çekingen ve benzerleri). Birbirlerinin can durumunu ve hamlelerini bilip akıl yürütmeliler. **TypeSafe Jev** kullanılarak mimari kurulabilir (key yalnız sunucuda; sahibinin secret store'unda yenilenmiş credential; sohbetteki eski anahtar kullanılmaz).
2. **Hakem:** animasyonları kötü, boksörlerin neredeyse içine giriyor, yürüyüşü yanlış, görüntüsünde kesilmeler var.
3. **Temas:** boksörler hâlâ birbirinin içinden geçiyor.

Somut dosya düzeyinde planlar (4 paralel inceleme): **`docs/handoff/ringside-next-session-plans.md`** — kapsül temas modeli + render penetrasyon çözücü; NeuroBoxer v2 stratejist (12 stratejik gözlem, rakip eğilim EMA'ları, stil başlığı, histerezis, aşamalı ES eğitimi, değerlendirme); Jev stil katmanı (karar noktaları, karar günlüğü, zaman aşımında deterministik fallback, sunucu rotası); hakem hareket/yürüyüş düzeltmesi ve ölçülebilir kabul eşikleri.

Kural hatırlatmaları: dövüş sonucu ağ gecikmesine bağlı olmamalı (karar günlüğü ile replay); gözlemlerde bahis/bakiye/kimlik/gelecek seed yok; neuro-1 modeli ve sparring-4 kanıtları korunur, yeni davranış yeni sürüm (neuro-2 / sparring-5); bağlantı haritası üstünlüğü henüz gösterilmedi, iddia edilmez; build ile tam tarayıcı paketi ve akıcılık probu (`?probe=1`) her değişiklikte yeniden çalıştırılır.

### Devam kaydı — 5 Ekim 2026 (7): dört paralel iş tamamlandı (yayımlanmadı)

- **Yapılan (4 alt ajan + koordinatör):**
  - `sparring-5` kapsül teması: `combat-capsules.ts`; render düzeltici `boxing-contact-resolver.ts` + `boxing-contact-capsules.json`.
  - Hakem: `combat-referee.ts`, `boxing-referee-motion.ts`.
  - NeuroBoxer v2: `neuro-boxer-2.ts`, `neuro-boxer-2-model.ts`; ürün modeli s1 `d1e8f30d…`.
  - Jev stil katmanı:
    - Protokol ve log: `fight-style.ts` (`style-log-1`).
    - Sunucu: `apps/web/app/api/ringside/style/route.ts`, `lib/server/typesafe-style.ts`.
    - Sayfa ve önbellek: `lib/sparring-corners.ts`, `lib/jev-style-cache.*`; yeni `boxing-sparring.tsx` ve `neuro-thinking-panel.tsx`.
  - Koordinatör kurulumu: `sparring-4` dondurma (`experiments/combat-sparring-audit/baseline-sparring-4.ts`), referee seam, `fight-style` sözleşmesi, `scripts/dev/with-lock.mjs`.
- **Kanıt:** `ops/evidence/ringside-sparring5-20261005.json` ve aynı adlı dizin (gerçek sahne raporu). Ayrıntılar:
  - `ops/evidence/ringside-{style,neuro2,referee,sparring-contact}-20261004/`
  - `experiments/neuro-boxer/{evidence-style,evidence-mirror-product}.json`
  - `experiments/decision-agent/evidence/style-*`
  - `experiments/combat-sparring-audit/evidence/{referee,contact,sparring5}-*`
  - `docs/validation.md` ve spec'teki 5 Ekim bölümleri.
- **Test:**
  - protocol 105, web 92, decision-agent 21; tsc ve typecheck temiz.
  - GLB: sparring-replay 10/10 × 3, hakem 4/4 × 2, temas GLB 1/2 (eşik FAIL).
  - Build `RQQVZsiqtnBTkcFGuWvNz`, tarayıcı **81/81** (yerel workerd :3002).
  - Readiness BLOCKED / exit 2.
- **Bilinen FAIL ve açıklar:**
  - Eldiven ve kol iç içe geçmesi (gerçek sahnede karelerin ~%35'i >1 cm; gövde çifti ~%1).
  - Kol IK kemik hızı p99 ~180 rad/sn.
  - Canlı kök kayması hız sınırı 3 m/sn (ölçülmüş uzlaşma; bacakta geçici örtüşme artar). Kalıcı çözüm sabit bir ayırma eksenidir.
  - Hakemin gerçek sahnede adım başına ayak kayması 2,51 cm (eşik <2) ve kamera tarafında daha sık durması.
  - Stratejist en iyi sabit stili geçmiyor; neuro-2 ayna maçlarında nakavt yok.
  - Motor tick maliyeti 2,2 kat arttı (eğitim yavaşladı).
- **Kullanıcı kararı bekleyenler:**
  - Yayın (`build:cloudflare` + `wrangler deploy`).
  - Barındırılan Jev için `wrangler secret put TYPESAFE_API_KEY` + `DECISION_AGENT_ENABLED` var. Değer `.tooling/secrets/typesafe.env` dosyasından alınır, ekrana yazılmaz.
  - Sohbette paylaşılan anahtarın yenilenmesi.
  - s1 ürün modeli seçiminin onayı.
- **Yerel Jev denemesi:** `cd apps/web && bash ../../scripts/use-node.sh pnpm exec wrangler dev --port 3002 --env-file /Users/macmini/Desktop/Sollish/.tooling/secrets/typesafe.env --var DECISION_AGENT_ENABLED:true`. OpenNext `preview` `--env-file`'ı iletmez. Gerçek çağrı sayısı 74/150 (bu iş için konan bütçe).
- **Çalışan süreçler:**
  - Port 3002'de anahtarsız üretim önizlemesi açık bırakıldı.
  - Port 3001'deki eski önizleme ve 7 saatlik eski wrangler süreci durdurulamadı (izin reddi); kullanıcı isterse kapatır.
- **Sonraki iş önerisi:**
  - Gard/eldiven temasını motor düzeyinde ele almak: yakın mesafede gardlı kolların çarpışma hacmi ve render'da kol IK yumuşatması.
  - Ayna maçlarında pasifliği cezalandıran ve daha güçlü held-out rakiple neuro-2 yeniden eğitimi.
  - Hakem ayak kayması.
</resume_checkpoint>

<start_now>

**Şimdi Sollish'i devral.** Önce çalışma klasörü, AGENTS/product spec ve son release kanıtını okuyup bu dosyadaki mevcut durumla karşılaştır. Önemli çelişki varsa kanıtıyla belirt. En fazla kısa bir başlangıç özeti ve uygulanabilir ilk iş sırasını ver; kullanıcıdan daha önce verdiği bilgileri tekrar isteme. Ardından mevcut yetki ve araçlarınla P0 ve P1'e başla, gerçek oyun kalitesini iyileştir, uygun testleri çalıştır ve sonucu hareket halinde doğrula. Yapılabilir işi “istersen devam ederim” diye bekletme. Başarıyı yalnız kanıtlanan kapsamda bildir; gerçek para kapılarını, eski biletleri ve veri/anahtar güvenliğini koru. Bağlam değiştiğinde bu tek dosyadaki devam kaydını güncelleyerek aynı klasörde devam et.

</start_now>
