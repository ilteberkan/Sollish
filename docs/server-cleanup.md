# Sunucu temizliği — 1 Ekim 2026

## Yetki ve kapsam

Kullanıcının doğrudan talimatı: **“Yedek almadan tüm uygulamaları ve verilerini sil; Debian ve SSH kalsın.”** İşlem `ssh sunucum` ile erişilen mevcut VPS üzerinde gerçekleştirildi. Yeni yedek alınmadı; uygulamaların eski yerel yedekleri de silindi. Debian yeniden kurulmadı.

## Yapılan işlemler

- Opia medya servisi ve uygulamaya özel başlangıç birimleri durdurulup devre dışı bırakıldı; uygulama yedek cron işi kaldırıldı.
- Container yeniden başlatma politikaları kapatıldı; 17 container kaldırıldı.
- 6 Docker volume'u, 18 image, uygulama ağları ve build cache temizlendi.
- Opia uygulama dizinleri, self-host Supabase verileri, Coolify dosyaları, deployment arşivleri, eski yedekler ve ilgili uygulama sırlarını içeren dizinler kaldırıldı. Sırların içerikleri rapora alınmadı.
- Docker/containerd, Node/npm, Certbot ve PostgreSQL istemcileri dahil 167 paket kaldırıldı. Ardından 343 kullanılmayan bağımlılık kaldırıldı; işlem planında SSH ve temel sistem bileşenlerinin bulunmadığı önceden kontrol edildi.
- Kalan Docker/Node veri ve kurulum dizinleri, uygulama TLS sertifikaları ve kullanıcı paket cache'leri temizlendi.
- Debian, SSH yapılandırması/anahtarları, kullanıcı hesapları, Fail2ban, otomatik sistem güncellemeleri ve temel işletim sistemi servisleri korundu.

Bulut hesaplarında proje, DNS, ücretli plan veya veri değişikliği yapılmadı. Bu işlem, sağlayıcı snapshot'larının ya da fiziksel disk bloklarının güvenli silindiği iddiası değildir.

## Doğrulanan sonuç

Temizlikten sonra ayrı SSH bağlantısıyla kontroller tamamlandı:

| Kontrol | Sonuç |
| --- | --- |
| Yeni SSH bağlantısı | Başarılı |
| `sshd -t` | Hatasız |
| SSH / Fail2ban / unattended-upgrades | Aktif |
| TCP/UDP dinleyen portlar | Yalnız TCP 22, IPv4 ve IPv6 |
| `dpkg --audit` | Sorun bildirmedi |
| `apt-get check` | Başarılı |
| Docker, Node, npm, Certbot komutları | Kurulu değil |
| `/opt` ve `/data` | Uygulama içeriği kalmadı |
| İncelenen uygulama/başlangıç/geçici dizinleri | Opia/Coolify/Supabase adlı kalıntı bulunmadı |
| RAM | 7.929 MiB toplam, yaklaşık 7.497 MiB kullanılabilir |
| Disk | Yaklaşık 251 GiB toplam, 8,9 GiB kullanılmış, 232 GiB boş |

Kaynak değerleri son ölçüm anına aittir. Sunucu yeniden başlatılmadı; yeniden başlatma sonrası test yapıldığı iddia edilmez. Sollish runtime'ı veya uygulaması henüz bu sunucuya kurulmadı. Sonraki kurulum ARM64 işçi yerleşimine göre yapılacak.
