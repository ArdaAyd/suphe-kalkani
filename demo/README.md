# Demo Senaryoları

ŞüpheKalkanı'nı denemek için hazır örnek dosyalar. Jüri ve test kullanıcıları
bu dosyaları arayüze yükleyerek ürünü hızlıca deneyebilir.

Her kategoride hem **sahte** (dolandırıcılık) hem **gerçek** (güvenli) örnek
vardır. `gercek` ile başlayan dosyalar, aracın gerçek kurumsal mesajlarda
**yanlış pozitif vermediğini** doğrulamak içindir.

## Banka / Finans senaryoları

| Dosya | İçerik | Amaçlanan sonuç |
|---|---|---|
| `banka-gercek.jpeg` | Yapı Kredi'nin gerçek pazarlama SMS'i — resmi domainler (`yapikrediplay.com.tr`, `yukle.yapikredi.com`) | DÜŞÜK / güvenli |
| `banka-sahte.png` | Sahte Ziraat Bankası SMS'i — "hesabınız bloke edildi", aciliyet baskısı, sahte link `ziraatbank-giris.com` | YÜKSEK |
| `banka-sahte-2.png` | Sahte banka phishing e-postası — gönderici `guvenlik@guvenbank-destek-mail.com`, kart/kod talebi | YÜKSEK |
| `banka-sahte.mp4` | Sahte banka araması videosu — sesli dolandırıcılık (vishing) senaryosu | YÜKSEK |

## E-Ticaret senaryoları

| Dosya | İçerik | Amaçlanan sonuç |
|---|---|---|
| `eticaret-gercek.png` | Gerçek Teknosa kampanyası — resmi domain `teknosa.com`, makul %5 indirim | DÜŞÜK / güvenli |
| `eticaret-sahte.png` | Sahte iPhone 15 Pro Max kampanyası — 9.999 TL, %70 indirim, "son 2 saat", sahte domain `apple-kampanya-tr.com` | YÜKSEK |
| `eticaret-sahte-2.png` | Sahte Amazon e-postası — "2.500 TL hediye çeki kazandınız", gönderici `amazon-destek-mail.com` | YÜKSEK |
| `eticaret-sahte.mp4` | Sahte e-ticaret tanıtım videosu | YÜKSEK |

## Nasıl test edilir?

1. `npm run dev` ile uygulamayı başlat, `http://localhost:3000` adresini aç.
2. Görsel veya video dosyasını sürükle-bırak alanına bırak.
3. "Analiz Et" butonuna bas.

Görseller metin/marka/URL çıkarımının ve görsel doğruluk (deepfake/AI)
analizinin; videolar ise ses transkripsiyonu ve multimodal analizin
test edilmesini sağlar.
