# Agentic Davranış — Kanıtlar

Bu doküman ŞüpheKalkanı'nın "agentic AI" iddiasını somut log ve API çıktılarıyla belgeler. Burada gösterilen tüm değerler **gerçek `curl` çağrılarından** alınmıştır; tekrar üretmek için her örneğin yanında komutu bulabilirsiniz.

İçindekiler:

1. ["Agentic" Ne Demek?](#1-agentic-ne-demek)
2. [Testleri Yerel Olarak Çalıştırma](#2-testleri-yerel-olarak-çalıştırma)
3. [Örnek 1 — Sahte Trendyol Kampanyası](#3-örnek-1--sahte-trendyol-kampanyası)
4. [Örnek 2 — Banka Phishing'i (Ziraat)](#4-örnek-2--banka-phishingi-ziraat)
5. [Örnek 3 — Gerçek Kurumsal E-posta (Yanlış Pozitif Testi)](#5-örnek-3--gerçek-kurumsal-e-posta-yanlış-pozitif-testi)
6. [Örnek 4 — Bilinmeyen Marka (Hopi)](#6-örnek-4--bilinmeyen-marka-hopi)
7. [Örnek 5 — Sahte Modanisa Kampanyası](#7-örnek-5--sahte-modanisa-kampanyası)
8. [Örnek 6 — Deepfake Müşteri Hizmetleri Videosu](#8-örnek-6--deepfake-müşteri-hizmetleri-videosu)
9. [Audit Trail — Sunucu Logu](#9-audit-trail--sunucu-logu)

---

## 1. "Agentic" Ne Demek?

LLM tabanlı bir aracın "agentic" sayılması için, modelin **kendisi karar verip eylem yapabilmesi** gerekir. ŞüpheKalkanı'nda Gemini iki tür otonom eylem alır:

1. **Canlı Google araması** — Hangi sorguları yapacağına Gemini kendi karar verir. Sorgular response içinde `webSearchQueries` olarak görünür.
2. **Güvenlik aracı çağırma** — Hangi araçları (`check_domain_age`, `check_iban_validity`, `check_url_safety`) hangi argümanlarla çağıracağına Gemini kendi karar verir. Çağrılar response içinde `toolCalls` olarak görünür.

Bunlar **simülasyon değildir** — Gemini API'sinin native function calling ve Google Search grounding özelliklerinin gerçek kullanımıdır.

---

## 2. Testleri Yerel Olarak Çalıştırma

```bash
# 1) Sunucuyu başlat
npm run dev
# Tarayıcıda http://localhost:3000

# 2) Tek satırlık curl ile API'ye gönder
curl -s -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"input": "MESAJI BURAYA YAZ"}' | python3 -m json.tool
```

Aşağıdaki örneklerin her birini bu şablonla deneyebilirsiniz.

---

## 3. Örnek 1 — Sahte Trendyol Kampanyası

**Senaryo:** Gerçek olmayacak kadar düşük fiyatlı bir iPhone kampanyası iddiası + şüpheli URL.

### Komut

```bash
curl -s -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"input": "Trendyol Black Friday Özel! iPhone 15 Pro 999 TL! Son 2 saat! Hemen sipariş ver: http://trendyol-kampanya.xyz/iphone-indirim"}'
```

### Gemini'nin Otonom Eylemleri

**Canlı Google aramaları** (Faz 1):

```
"Trendyol resmi site"
"Apple resmi site"
"trendyol-kampanya.xyz trendyol resmi mi"
"Trendyol iPhone 15 Pro 999 TL gerçek mi"
"Trendyol Black Friday iPhone 15 Pro 999 TL kampanyası"
```

**Çağırdığı güvenlik araçları** (Faz 2):

```
check_domain_age({"domain": "trendyol-kampanya.xyz"})
check_url_safety({"url": "http://trendyol-kampanya.xyz/iphone-indirim"})
```

### Yanıt (kısaltılmış)

```json
{
  "extraction": {
    "brandNames": ["Trendyol", "iPhone 15 Pro"],
    "priceClaims": ["iPhone 15 Pro 999 TL"],
    "discountClaims": ["Black Friday Özel!", "999 TL"],
    "urgencyPhrases": ["Son 2 saat!", "Hemen sipariş ver"]
  },
  "validation": {
    "urlRisk": 80,
    "brandSpoofRisk": 100,
    "ecommerceRisk": 100,
    "reasoning": "URL analizi, şüpheli TLD ve HTTP kullanımı gibi yüksek risk faktörleri tespit etti. Marka doğrulama bulguları sahte bir Trendyol kampanyası olduğunu gösteriyor.",
    "webSearchQueries": [ /* yukarıdaki 5 sorgu */ ],
    "toolCalls": [ /* yukarıdaki 2 çağrı */ ]
  },
  "report": {
    "finalScore": 95,
    "riskLevel": "HIGH",
    "headline": "Bu, sizi kandırmak için yapılan bir dolandırıcılık girişimi.",
    "summary": "Size gelen mesajdaki Trendyol ve iPhone 15 Pro kampanyası tamamen yalan. Telefonun 999 TL olması imkansız."
  }
}
```

### Hangi sinyaller hangi katmandan geldi?

| Bulgu | Kaynak |
|---|---|
| "iPhone 15 Pro için 999 TL piyasa değeri ~45.000 TL" | Deterministik (`detectPricingAnomalies` — ürün fiyat sözlüğü) |
| ".xyz şüpheli TLD" | Function call (`check_url_safety`) |
| "Domain çok yeni / kayıt yok" | Function call (`check_domain_age` → RDAP 404) |
| "Kampanya iddiası gerçek değil" | Gemini Google Search (`Trendyol iPhone 15 Pro 999 TL gerçek mi`) |
| `brandSpoofRisk: 100` | Hem deterministik (`checkDomainSpoof` — Trendyol resmi domain `trendyol.com`, mesajdaki `trendyol-kampanya.xyz`) hem Faz 1 doğrulaması |

Tek bir katman bu kararı tek başına veremezdi. Agentic yapının değeri burada görünür.

---

## 4. Örnek 2 — Banka Phishing'i (Ziraat)

**Senaryo:** Klasik banka phishing kalıbı — hesap dondurma uyarısı + sahte URL + IBAN.

### Komut

```bash
curl -s -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"input": "Ziraat Bankası hesabınız donduruldu! Hemen güncelleyin: http://ziraatbank-giris.xyz IBAN: TR33 0006 1005 1978 6457 8413 26"}'
```

### Gemini'nin Otonom Eylemleri

**Canlı Google araması** (Faz 1) — sadece bir arama, çünkü Ziraat zaten Gemini'nin world knowledge'ında var ama yine de doğrulamak istedi:

```
"Ziraat Bankası resmi site"
```

**Çağırdığı araçlar** (Faz 2):

```
check_domain_age({"domain": "ziraatbank-giris.xyz"})
check_url_safety({"url": "http://ziraatbank-giris.xyz"})
check_iban_validity({"iban": "TR33 0006 1005 1978 6457 8413 26"})
```

### Yanıt (özet)

```
finalScore: 100 / HIGH
brandSpoofRisk: 100   (Ziraat resmi domain ziraatbank.com.tr, mesajdaki ziraatbank-giris.xyz)
urlRisk: 80
ibanRisk: 75
headline: "Bu mesaj büyük olasılıkla paranızı çalmaya çalışan bir tuzak."
```

### İlginç detay

`check_iban_validity` IBAN'ın matematiksel olarak **geçerli** olduğunu döndürdü. Bu beklendiği gibi olabilir — dolandırıcılar genelde gerçek IBAN kullanır (kendi para alacakları hesap). Sistem buna rağmen `finalScore: 100` döndürdü çünkü diğer sinyaller (domain spoof, URL şüphesi, marka taklidi) ezici çoğunlukla "phishing" diyor.

Bu, hibrit yaklaşımın gücüdür: tek bir testin "temiz" çıkması diğerlerini geçersiz kılmaz.

---

## 5. Örnek 3 — Gerçek Kurumsal E-posta (Yanlış Pozitif Testi)

**Senaryo:** Gerçek Trendyol pazarlama e-postası. Anahtar test: sistem yanlışlıkla `HIGH` döndürürse projemiz kullanışsız olur.

### Komut

```bash
curl -s -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"input": "From: Trendyol <news@email.trendyol.com>\nMerhaba, Trendyol'\''u arkadaşlarına tavsiye eder misin? NPS anketimize 1 dakikanı ayır: https://www.trendyol.com/anket"}'
```

### Faz 1'in Yapısal Doğrulaması

```json
{
  "brandImpersonation": "legitimate",
  "urlVerdicts": [
    {
      "url": "https://www.trendyol.com/anket",
      "verdict": "official",
      "note": "trendyol.com Trendyol'un resmi alanı"
    }
  ],
  "emailVerdicts": [
    {
      "email": "news@email.trendyol.com",
      "verdict": "official",
      "note": "email.trendyol.com Trendyol'a ait subdomain — meşru pazarlama gönderici"
    }
  ]
}
```

### Search Override Devrede

Faz 1 hem URL'i hem e-postayı `official` doğruladığı için:

- `brandConfirmedLegit = true`
- Heuristik "marka + URL bir arada = 60" **iptal edildi**
- `concreteSpoof = 0` (zaten resmi)
- `brandSpoofRisk = 0`

### Yanıt

```
finalScore: 21 / LOW
brandSpoofRisk: 0
headline: "Trendyol'dan gelen bu e-posta şu an için güvenli görünüyor."
```

**Söz konusu olan:** Eğer search override mekanizması olmasaydı, eski heuristik bu mesajı yanlışlıkla 60+ risk verecekti. Yanlış pozitif önlendi.

---

## 6. Örnek 4 — Bilinmeyen Marka (Hopi)

**Senaryo:** "Hopi" gibi bir marka sözlüğümüzde olabilir veya olmayabilir. Gemini'nin Google Search üzerinden bilinmeyen markaları da doğrulayabilmesi tasarımın temel hedeflerinden biri.

### Komut

```bash
curl -s -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"input": "Sayın müşterimiz, Hopi puanlarınız bugün sona eriyor! Hemen tıklayın: http://hopi-puan.xyz/giris"}'
```

### Gemini'nin Otonom Eylemleri

Marka adı yakalandı (`brandNames: ["Hopi"]`), Faz 1 tetiklendi:

```
Google aramaları:
"Hopi resmi site"
"hopi.com.tr"
"hopi-puan.xyz Hopi resmi mi"

Faz 1 verdict:
brandImpersonation: "spoof"
URL → hopi-puan.xyz: spoof (Hopi'nin resmi domain'i hopi.com.tr)
```

```
Function calls:
check_domain_age({"domain": "hopi-puan.xyz"})
check_url_safety({"url": "http://hopi-puan.xyz/giris"})
```

### Yanıt

```
finalScore: 70 / HIGH
brandSpoofRisk: 100   (Faz 1 spoof + heuristik)
urlRisk: 80
headline: "Bu bağlantıya sakın tıklamayın, dolandırıcılar sizi kandırmaya çalışıyor."
```

**Önemli:** Hopi sözlüğümüzde **olsa da olmasa da**, Google Search üzerinden gerçek domain (`hopi.com.tr`) öğrenildi ve sahte URL ile karşılaştırıldı. Sistem küçük/yerel markalara da ölçeklenebilir.

---

## 7. Örnek 5 — Sahte Modanisa Kampanyası

**Senaryo:** Bilinmeyen marka + sahte indirim oranı + şüpheli URL.

### Komut

```bash
curl -s -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"input": "Modanisa indirim! %80 indirim son gün! Hemen tıklayın: http://modanisa-kampanya.top/indirim"}'
```

### Gemini'nin Otonom Eylemleri

```
Google aramaları:
"Modanisa resmi web sitesi"
"modanisa official website"
"modanisa %80 indirim gerçek mi"
"modanisa 80% discount real"
```

Gemini hem markayı hem kampanya iddiasını ayrı ayrı araştırdı. Bu, prompt'un "kampanya iddiası varsa: gerçek mi" sorusunu sorma talimatının somut sonucudur.

### Yanıt

```
finalScore: 81 / HIGH
ecommerceRisk: 100   (%80 indirim + URL kombinasyonu)
brandSpoofRisk: 100  (modanisa.com resmi, modanisa-kampanya.top spoof)
headline: "Bu mesaj sizi kandırmak için yapılmış, dikkat edin."
```

---

## 8. Örnek 6 — Deepfake Müşteri Hizmetleri Videosu

**Senaryo:** Trendyol müşteri hizmetleri kılığına girmiş AI-üretimi video — kullanıcı ile videoyu yüklüyor.

### Komut

```bash
curl -s -X POST http://localhost:3000/api/analyze \
  -F "input=" \
  -F "video=@deepfake-test.mp4"
```

### Çoklu Agent Çıktısı

**VideoAnalysisAgent → transcript:**

```
"Merhaba değerli müşterimiz. Sizi Trendyol'dan arıyoruz.
Hesabınıza 1000 TL'lik kupon tanımlanmıştır.
Kuponunuzun son kullanma tarihi iki gün içinde dolacaktır.
Kuponunuzu kullanmak için telefonunuza gönderilen linkle tıklayabilirsiniz."
```

**VideoAnalysisAgent → visualObservations:**

```
- Konuşan kişinin dudak hareketleri ile ses senkronizasyonu tutarsız
- Yüzünde yapay bir görünüm var, deepfake olasılığı yüksek
- Arka plandaki "Trendyol" logosu manipüle edilmiş olabilir
```

**Validation → deepfake sinyalleri taranıyor:**

```ts
detectDeepfakeSignals([
  "Konuşan kişinin dudak hareketleri ile ses senkronizasyonu tutarsız",
  "Yüzünde yapay bir görünüm var, deepfake olasılığı yüksek",
  ...
])
// → { risk: 95, signals: [...] }
```

### Yanıt

```
finalScore: 85 / HIGH
deepfakeRisk: 95
brandSpoofRisk: 40
urgencyRisk: 100
headline: "Bu sesli arama, Trendyol adına yapılan bir dolandırıcılık girişimi."
summary: "Konuşan kişinin deepfake olma ihtimali yüksek ve kuponu kullanmak için bir bağlantıya tıklamanız isteniyor. Bu kesinlikle bir dolandırıcılık."
```

### Bonus tetiklendi

`calculateFinalScore` kombinasyon bonusu:
- `deepfakeRisk: 95 ≥ 60 && brandSpoofRisk: 40 ≥ 40` → **+30 bonus**

Bu kombinasyonun özel bonus alması bir tasarım kararı: AI ile marka taklidi = en tehlikeli kombinasyon.

---

## 9. Audit Trail — Sunucu Logu

Geliştirici konsolu, validation agent'ın her eyleminde aşağıdaki gibi loglar üretir. Bu loglar, jüri veya kullanıcı `webSearchQueries` ve `toolCalls` alanlarına ek olarak da agentic davranışı doğrulayabilir.

```
[Gemini] 5 API key yüklendi
Extraction Agent çalıştı
Validation Agent çalıştı
[ValidationAgent] Faz 1 — Google'da 5 arama yapıldı: [
  'Trendyol resmi site',
  'Apple resmi site',
  'trendyol-kampanya.xyz trendyol resmi mi',
  'Trendyol iPhone 15 Pro 999 TL gerçek mi',
  'Trendyol Black Friday iPhone 15 Pro 999 TL kampanyası'
]
[ValidationAgent] Marka doğrulama özeti: trendyol.com resmi alan; trendyol-kampanya.xyz SAHTE...
[ValidationAgent] Faz 2 — Gemini 2 araç çağırdı: [
  'check_domain_age({"domain":"trendyol-kampanya.xyz"})',
  'check_url_safety({"url":"http://trendyol-kampanya.xyz/iphone-indirim"})'
]
[ValidationAgent] Araç sonuçları: [
  { domainAge: null, riskLevel: 'UNKNOWN', reason: 'RDAP yanıt vermedi (404).' },
  { riskScore: 80, riskFactors: ['Şüpheli .xyz TLD', 'Domain adında tire (-)', 'HTTP'] }
]
Judgement Agent çalıştı
Orchestrator tamamlandı
```

Her log satırı **gerçek bir LLM kararını** veya **gerçek bir dış API çağrısını** temsil eder. Sahte simülasyon yoktur.

---

İlgili dokümanlar:

- [README.md](../README.md) — yüksek seviye proje tanıtımı
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) — mimari, risk hesaplama, hata yönetimi
