# ŞüpheKalkanı

ŞüpheKalkanı; şüpheli mesaj, e-posta, kampanya görseli, ses kaydı veya videoyu analiz ederek dolandırıcılık riskini tespit eden, **Gemini destekli agentic yapay zeka** tabanlı bir güvenlik asistanıdır.

Kullanıcı şüpheli bir içeriği yapıştırır ya da yükler; sistem saniyeler içinde sade ve anlaşılır bir risk raporu üretir: risk skoru, risk seviyesi, içeriğin neden şüpheli olduğu ve kullanıcının ne yapması gerektiği.

## Problem

SMS, WhatsApp, e-posta, sahte kampanya görselleri, banka taklidi mesajlar ve sesli aramalar (vishing) yoluyla yapılan dolandırıcılık girişimleri hızla artmaktadır. Bu içeriklerde tipik risk sinyalleri şunlardır:

- Sahte veya marka taklidi bağlantılar
- Aciliyet ve panik baskısı
- IBAN veya ödeme yönlendirmesi
- Kimlik doğrulama / hesap kapatma bahanesi
- Gerçekçi olmayan fiyat, sahte indirim ve çekiliş vaatleri
- Yapay zeka ile üretilmiş (deepfake) görsel veya ses

Sıradan bir kullanıcı bu sinyalleri tek tek değerlendiremez. ŞüpheKalkanı bu değerlendirmeyi onun yerine yapar.

## Çözüm

Kullanıcı **metin, görsel, ses veya video** gönderir. İçerik, uzmanlaşmış ajanlardan oluşan bir agentic workflow ile analiz edilir ve şu çıktılar üretilir:

- Risk skoru (0–100)
- Risk seviyesi: LOW / MEDIUM / HIGH
- Tek cümlelik net karar (headline)
- Kırmızı bayraklar — içeriğin neden şüpheli olduğu
- Önerilen aksiyonlar — kullanıcının ne yapması gerektiği
- Risk boyutları: URL, IBAN, aciliyet, marka taklidi, e-ticaret, deepfake
- AI güven skoru

## Özellikler

- **Çok biçimli (multimodal) analiz** — metin, görsel, ses ve video.
- **Agentic mimari** — tek bir prompt yerine uzmanlaşmış ajan zinciri.
- **Google Search ile canlı doğrulama** — URL, marka ve e-posta adreslerinin resmi mi yoksa sahte mi olduğu gerçek zamanlı aramayla doğrulanır.
- **Function calling araçları** — domain tescil yaşı, IBAN matematiksel geçerliliği ve URL güvenlik analizi.
- **Görsel deepfake / AI üretimi tespiti** — yüklenen görselin yapay üretilmiş olup olmadığı değerlendirilir.
- **Sesli dolandırıcılık (vishing) tespiti** — ses ve video kayıtları transkribe edilip baskı / sahte yetkili kalıpları aranır.
- **E-ticaret dolandırıcılık sinyalleri** — gerçekçi olmayan fiyat, sahte indirim ve çekiliş tuzakları.
- **Yanlış pozitif koruması** — Google ile resmi olarak doğrulanan marka ve domainler yüksek risk almaz.
- **Sade dil** — yaşlı veya teknolojiden anlamayan kullanıcılar için teknik terim içermeyen, eylem odaklı rapor.

## Agentic Mimari

Projede tek bir prompt yerine uzmanlaşmış ajanlardan oluşan bir yapı kullanılmıştır.

```txt
Kullanıcı girdisi  (metin / görsel / ses / video)
        │
        ▼
   Orchestrator
        │
        ├─ AudioAnalysisAgent     ses  → transkript + vishing sinyalleri
        ├─ VideoAnalysisAgent     video → transkript + görsel sinyaller
        ├─ Extraction Agent       metin/görsel → URL, IBAN, marka, e-posta, iddialar
        └─ ImageAnalysisAgent     görsel → deepfake / AI üretimi riski
        │
        ▼
  Validation Agent
        ├─ Faz 1: Google Search ile URL / marka / e-posta doğrulama
        └─ Faz 2: Function calling araçları (domain yaşı, IBAN, URL güvenliği)
        │
        ▼
  Judgement Agent  →  Risk Raporu
```

### Orchestrator

Ajanları yönetir. Girdi türüne göre (metin, görsel, ses, video) ilgili ajanları çalıştırır, sonuçları birleştirir ve pipeline'ı sırayla ilerletir. Birbirinden bağımsız analizler (örneğin extraction ve görsel doğruluk analizi) paralel çalıştırılır.

### Extraction Agent

Gemini ile metni ve görseli analiz eder; içerikten URL, IBAN, telefon, marka/kurum adı, gönderici e-posta, iddialar, aciliyet ifadeleri, fiyat/çekiliş/indirim iddialarını ve kısa bir özeti çıkarır. Gemini bozuk yanıt verirse regex tabanlı fallback devreye girer.

### ImageAnalysisAgent

Yüklenen görseli, yapay zeka ile üretilmiş / deepfake olup olmadığı açısından değerlendirir; manipülasyon ve sahte arayüz/logo gibi görsel sinyalleri tespit eder.

### AudioAnalysisAgent / VideoAnalysisAgent

Ses ve video kayıtlarını transkribe eder; sesli dolandırıcılık (vishing) kalıplarını — baskı tonu, sahte yetkili kimliği, bilgi talebi — ve videolarda görsel dolandırıcılık sinyallerini tespit eder.

### Validation Agent

Çıkarılan verileri risk skorlarına dönüştürür. İki fazlı çalışır:

- **Faz 1 — Google Search doğrulaması:** İçerikteki URL, marka ve e-posta adreslerini canlı Google aramasıyla kontrol eder ve her biri için yapısal bir karar üretir: `official` / `spoof` / `unknown`.
- **Faz 2 — Function calling:** Gemini, güvenlik araçlarını çağırarak domain yaşı, IBAN geçerliliği ve URL güvenliğini analiz eder.

Ardından deterministik risk hesapları ile Gemini'nin değerlendirmesini birleştirir. **Search override:** Faz 1 bir domain veya e-postayı resmi olarak doğrularsa, sözlük tabanlı deterministik kontrollerin yarattığı yanlış pozitifler geri alınır — böylece gerçek kurumsal mesajlar yanlışlıkla riskli işaretlenmez.

### Judgement Agent

Validation sonucunu son rapora dönüştürür: final risk skoru, risk seviyesi, tek cümlelik karar, sade özet, kırmızı bayraklar, önerilen aksiyonlar ve güven skoru.

## Güvenlik Araçları (Function Calling)

Validation Agent, Gemini function calling ile aşağıdaki araçları çağırır:

| Araç | İşlevi |
|---|---|
| `check_domain_age` | Domainin RDAP üzerinden tescil yaşını öğrenir — çok yeni domainler yüksek risk taşır. |
| `check_iban_validity` | IBAN'ı ISO 7064 MOD 97-10 algoritmasıyla matematiksel olarak doğrular. |
| `check_url_safety` | URL'i şüpheli TLD, derin alt domain, IP adresi, kısaltma servisi gibi göstergelere göre analiz eder. |

## Kullanılan Teknolojiler

| Katman | Teknoloji |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Backend | Next.js Route Handlers (Node.js runtime) |
| Yapay Zeka | Google Gemini (`gemini-2.5-flash`) |
| SDK | `@google/genai` |
| Agentic yetenekler | Function calling, Google Search grounding, multimodal analiz |
| Şema doğrulama | Zod |
| Rate limit | In-memory |

## Proje Yapısı

```txt
src/
  app/
    api/analyze/route.ts        analiz API endpoint'i
    page.tsx                    kullanıcı arayüzü
  lib/
    agents/
      orchestrator.ts           ajan akışını yönetir
      extractionAgent.ts        içerikten veri çıkarımı
      imageAnalysisAgent.ts     görsel deepfake / AI analizi
      audioAnalysisAgent.ts     ses analizi
      videoAnalysisAgent.ts     video analizi
      validationAgent.ts        risk skoru + Google Search doğrulama
      judgementAgent.ts         final rapor
    gemini/client.ts            Gemini API + çoklu key rotasyonu
    tools/securityTools.ts      domain / IBAN / URL araçları
    utils/riskHelpers.ts        deterministik risk hesapları
    schemas/reportSchema.ts     Zod şemaları
demo/                           hazır örnek senaryo dosyaları
```

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

Proje kök dizininde `.env.local` dosyası oluşturun:

```env
GEMINI_API_KEY=buraya_gemini_api_key
```

Projeyi çalıştırın:

```bash
npm run dev
```

Tarayıcıda açın: `http://localhost:3000`

## Ortam Değişkenleri

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `GEMINI_API_KEY` | Evet | Google AI Studio'dan alınan Gemini API anahtarı. |
| `GEMINI_API_KEY_2` … `GEMINI_API_KEY_10` | Hayır | Ek API anahtarları. Bir anahtar kota dolduğunda (429) sistem otomatik olarak sıradakine geçer. |

API anahtarları yalnızca `.env.local` içinde tutulmalıdır; bu dosya `.gitignore` ile hariç tutulmuştur ve sürüm kontrolüne gönderilmemelidir.

## API Endpoint

### POST `/api/analyze`

Metin, görsel, ses ve/veya videoyu analiz eder.

`multipart/form-data` alanları:

| Alan | Tür | Açıklama |
|---|---|---|
| `input` | metin | Analiz edilecek metin (opsiyonel) |
| `file` | görsel | Görsel dosyası (opsiyonel) |
| `audio` | ses | Ses dosyası (opsiyonel) |
| `video` | video | Video dosyası (opsiyonel) |

Yalnızca metin için `application/json` ile `{ "input": "..." }` gövdesi de gönderilebilir.

Örnek yanıt (kısaltılmış):

```json
{
  "report": {
    "finalScore": 82,
    "riskLevel": "HIGH",
    "headline": "Bu mesaj büyük olasılıkla bir dolandırıcılık girişimi.",
    "summary": "Banka taklidi yapan sahte bir bağlantı ve aciliyet baskısı tespit edildi.",
    "redFlags": [
      "Şüpheli veya resmi olmayan bağlantı tespit edildi.",
      "Aciliyet baskısı oluşturmaya yönelik ifadeler mevcut."
    ],
    "recommendedActions": [
      "Bağlantılara tıklamayın; adresi tarayıcınıza elle yazın.",
      "Kurumun resmi müşteri hizmetleriyle iletişime geçin."
    ],
    "confidence": 88
  }
}
```

## Demo Senaryoları

`demo/` klasöründe ürünü hızlıca denemek için hazır örnek dosyalar bulunur — sahte ve gerçek banka / e-ticaret içerikleri (görsel ve video). `gerçek` örnekler, aracın meşru kurumsal mesajlarda yanlış pozitif vermediğini doğrular. Ayrıntılar `demo/README.md` içindedir.

Metin tabanlı hızlı örnekler:

| İçerik | Beklenen sonuç |
|---|---|
| `Merhaba, bu sadece bir test mesajıdır.` | LOW |
| `Trendyol indirim kuponunuz hazır. http://bit.ly/firsat-link adresine tıklayın.` | MEDIUM |
| `PTT kargonuz beklemede. http://bit.ly/sahte-link adresinden ödeme yapın. IBAN TR12...` | HIGH |

## Dayanıklılık ve Güvenlik

- **Rate limit** — bir IP için dakikada en fazla 5 analiz isteği.
- **Çoklu API anahtarı rotasyonu** — bir anahtar 429 (kota) hatası aldığında otomatik olarak sıradaki anahtara geçilir.
- **503 yeniden deneme** — model anlık olarak aşırı yüklendiğinde artan beklemeyle tekrar denenir.
- **Dürüst hata yönetimi** — yapay zeka servisine hiç ulaşılamadığında sistem sahte bir "güvenli" sonuç üretmez; kullanıcıya açıkça "analiz yapılamadı" uyarısı gösterir.
- **Fallback** — Gemini bozuk yanıt verdiğinde (servis erişilebilirken) deterministik analiz devreye girer.
- **Yüklenen dosyalar** geçici olarak işlenir ve analiz sonrası silinir; API anahtarları yalnızca ortam değişkeninde tutulur.
