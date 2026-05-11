# ŞüpheKalkanı

ŞüpheKalkanı, kullanıcıların şüpheli mesaj, kampanya metni veya ekran görüntülerini analiz ederek dolandırıcılık risklerini tespit eden agentic AI tabanlı bir güvenlik asistanıdır.

## Problem

Günümüzde kullanıcılar SMS, WhatsApp, e-posta, sahte kampanya görselleri ve banka taklidi mesajlar üzerinden dolandırıcılık girişimleriyle sıkça karşılaşmaktadır. Bu içeriklerde genellikle:

- Sahte bağlantılar
- Marka taklidi
- Aciliyet baskısı
- IBAN veya ödeme yönlendirmesi
- Kimlik doğrulama bahanesi
- Hesap kapatma tehdidi

şeklinde risk sinyalleri bulunur.

ŞüpheKalkanı bu sinyalleri analiz ederek kullanıcıya anlaşılır bir risk raporu sunar.

## Çözüm

Kullanıcı metin veya görsel yükler. Sistem içeriği Gemini destekli agentic workflow ile analiz eder ve aşağıdaki çıktıları üretir:

- Risk skoru
- Risk seviyesi: LOW / MEDIUM / HIGH
- Kırmızı bayraklar
- Önerilen aksiyonlar
- AI tespit detayları

## Agentic Mimari

Projede tek bir prompt yerine uzmanlaşmış ajanlardan oluşan bir yapı kullanılmıştır.

```txt
Kullanıcı girdisi
    ↓
Orchestrator
    ↓
Extraction Agent
    ↓
Validation Agent
    ↓
Judgement Agent
    ↓
Risk Raporu
```

### Orchestrator

Ajanların sırasını yönetir. Kullanıcıdan gelen metin ve görsel verisini alır, önce extraction agent'a, sonra validation agent'a, en son judgement agent'a gönderir.

### Extraction Agent

Gemini ile metin ve görsel analiz eder. İçerikten şu alanları çıkarır:

- URL
- IBAN
- Telefon
- Marka adı
- İddialar
- Aciliyet ifadeleri
- Kısa özet

Gemini hata verirse fallback olarak regex tabanlı analiz çalışır.

### Validation Agent

Çıkarılan bilgileri risk sinyallerine dönüştürür.

Kontrol edilen sinyaller:

- Şüpheli bağlantı
- Kısa link
- IBAN paylaşımı
- Aciliyet dili
- Marka taklidi
- Marka + link + aciliyet kombinasyonu

### Judgement Agent

Validation sonucunu final rapora dönüştürür.

Üretilen çıktılar:

- Final risk skoru
- Risk seviyesi
- Özet
- Kırmızı bayraklar
- Önerilen aksiyonlar
- Güven skoru

## Kullanılan Teknolojiler

| Katman | Teknoloji |
|---|---|
| Frontend | Next.js, TypeScript, Tailwind CSS |
| Backend | Next.js Route Handlers |
| AI | Gemini API |
| SDK | @google/genai |
| Şema doğrulama | Zod |
| Orkestrasyon | Native async functions |
| Rate limit | In-memory Map |
| Deploy hedefi | Vercel |

## Kurulum

Projeyi klonlayın:

```bash
git clone https://github.com/ArdaAyd/suphe-kalkani.git
cd suphe-kalkani
```

Bağımlılıkları kurun:

```bash
npm install
```

`.env.local` dosyası oluşturun:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

Projeyi çalıştırın:

```bash
npm run dev
```

Tarayıcıda açın:

```txt
http://localhost:3000
```

## Ortam Değişkenleri

`.env.example` dosyası örnek olarak bırakılmıştır.

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

Gerçek API key `.env.local` içinde tutulmalıdır. `.env.local` GitHub'a gönderilmemelidir.

## API Endpoint

### POST `/api/analyze`

Metin veya görsel analiz eder.

JSON örneği:

```json
{
  "input": "PTT kargonuz beklemede. Hemen ödeme yapmak için http://bit.ly/sahte-link adresine tıklayın."
}
```

Dönen örnek cevap:

```json
{
  "report": {
    "finalScore": 82,
    "riskLevel": "HIGH",
    "summary": "Yüksek riskli dolandırıcılık belirtileri tespit edildi.",
    "redFlags": [
      "Şüpheli bağlantı tespit edildi.",
      "IBAN paylaşımı tespit edildi."
    ],
    "recommendedActions": [
      "Bağlantılara dikkat edin.",
      "Kişisel bilgi paylaşmayın.",
      "Ödeme öncesi resmi doğrulama yapın."
    ],
    "confidence": 88
  }
}
```

## Demo Senaryoları

### 1. Güvenli Mesaj

```txt
Merhaba, bu sadece test mesajıdır.
```

Beklenen sonuç:

```txt
LOW
```

### 2. Sahte Kampanya

```txt
Trendyol indirim kuponunuz hazır. Hemen almak için http://bit.ly/firsat-link adresine tıklayın.
```

Beklenen sonuç:

```txt
MEDIUM
```

### 3. IBAN + Link Dolandırıcılığı

```txt
PTT kargonuz beklemede. Hemen ödeme yapmak için http://bit.ly/sahte-link adresine tıklayın. IBAN TR120006200519786457841326
```

Beklenen sonuç:

```txt
HIGH
```

### 4. Görsel Analizi

Kullanıcı sahte banka SMS'i veya sahte kampanya ekran görüntüsü yükler.

Beklenen sonuç:

```txt
AI görseldeki metni okur, marka/URL/aciliyet ifadelerini çıkarır ve risk raporu üretir.
```

## Güvenlik ve Kullanıcı Deneyimi

Projede şu güvenlik ve UX detayları eklenmiştir:

- API key `.env.local` içinde saklanır.
- `.env.example` örnek olarak verilir.
- Rate limit ile 1 dakikada maksimum 5 analiz isteği sınırı uygulanır.
- API hata mesajları kullanıcı arayüzünde gösterilir.
- Loading state ile analiz süreci kullanıcıya gösterilir.
- Gemini hata verirse fallback sistem devreye girer.

## Mevcut Durum

Proje şu anda çalışan bir MVP durumundadır.

Tamamlanan özellikler:

- Metin analizi
- Görsel yükleme
- Gemini Vision entegrasyonu
- Agentic workflow
- Risk skoru
- Risk seviyesi
- Red flags
- Önerilen aksiyonlar
- AI tespit detayları
- Rate limiting
- Error handling
- Loading state

## Sonraki Geliştirmeler

- Vercel deploy
- Daha gelişmiş UI tasarımı
- Demo video
- Daha fazla test senaryosu
- Domain doğrulama API entegrasyonu
- PDF rapor çıktısı
