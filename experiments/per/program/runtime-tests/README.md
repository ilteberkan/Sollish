# Yerel SBF runtime testleri

```sh
bash experiments/per/program/runtime-tests/run-local.sh
```

Komut ana `build-local.sh` akışını çalıştırır: güncel lock ile probe ve callback fixture SBF dosyalarını yeniden derler, runtime testleri/lint/format/IDL kontrollerini yapar. Ağa deployment, faucet, QFS veya TDX çağrısı yapmaz. Sonraki hızlı çalıştırma için derlemeden sonra `cargo +1.95.0 test -p per-probe-runtime-tests --locked` kullanılabilir.

Testler LiteSVM'nin gerçek transaction imza doğrulaması ve derlenmiş Anchor programıyla initialization, PDA/oyuncu bağları, callback scoped signer CPI, id/tag/state/replay, receipt nonce, başarısız işlem rollback'i ve readonly hesabın değişmeden kalmasını kontrol eder. Değiştirilmiş transaction imzası ayrıca runtime tarafından reddedilir.

`inject_round` ve `inject_permission` açıkça sentetik VM kurulumu yapar. Delegation veya Permission programının gerçekten çalıştığı anlamına gelmez. Callback fixture sağlayıcı program adresine **yalnız yerel VM içinde** yüklenir; keyfi test baytlarını scoped signer ile iletir. VRF proof, queue/request registration, oracle veya TEE doğrulamaz. SBF derlemesi `test-fixture` özelliği olmadan engellenir; hiçbir ortak cluster'a deploy edilmemelidir.

Logs/return-data testinde kullanılan randomness sabit ve açıktır. İç callback instruction verisi bu baytları içerir; yerel VM bunları filtrelemez. Simülasyon writable olarak yükseltilmiş bir round account metasının hesap verisini döndürebilir. Bu test QFS sızıntısı bulgusu veya gizlilik başarısı değildir: gerçek PER tarafında account/message/inner-instruction/simulation/WS erişim kontrolünün ayrıca sınanması gerektiğini somutlaştırır. **G1–G3 bu testlerle PASS olmaz.**
