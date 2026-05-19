# Mimari Dokümantasyonu

Bu doküman ŞüpheKalkanı'nın iç işleyişini teknik olarak anlatır — agent topolojisi, veri akışı, risk hesaplama mantığı ve hata yönetimi. README'deki yüksek seviye anlatımın derinleştirilmiş halidir.

İçindekiler:

1. [Genel Bakış](#1-genel-bakış)
2. [Veri Akışı](#2-veri-akışı)
3. [Ajan Detayları](#3-ajan-detayları)
4. [Validation Agent — İki Fazlı Tasarım](#4-validation-agent--iki-fazlı-tasarım)
5. [Risk Hesaplama Boru Hattı](#5-risk-hesaplama-boru-hattı)
6. [Yanlış Pozitif Koruması — "Search Override"](#6-yanlış-pozitif-koruması--search-override)
7. [Function Calling Mimarisi](#7-function-calling-mimarisi)
8. [Şema ve Tipler](#8-şema-ve-tipler)
9. [Dayanıklılık Mekanizmaları](#9-dayanıklılık-mekanizmaları)
10. [Tasarım Kararları](#10-tasarım-kararları)

---

## 1. Genel Bakış

ŞüpheKalkanı, **tek bir prompt** yerine **uzmanlaşmış ajan zinciri** kullanır. Bu, tek dev bir prompt'a kıyasla şu kazanımları sağlar:

- Her ajan kendi konusuna odaklanmış prompt'la daha tutarlı çıktı verir.
- Her aşamanın çıktısı **Zod ile şema doğrulamasından** geçer; "Gemini ne demiş" değil "Gemini şu yapıda ne demiş" garantisi.
- Bir ajan başarısız olursa pipeline akıllı şekilde fallback'e döner veya hata fırlatır.
- Function calling ve Google Search grounding sadece **Validation Agent**'a verilir; diğer ajanlar saf metin üretir → daha öngörülebilir.

Çalıştırma ortamı: **Next.js 16 Route Handler (Node.js runtime)**. Streaming kullanılmaz — `POST /api/analyze` tek bir JSON yanıtı döndürür.

---

## 2. Veri Akışı

```
┌────────────────────────────────────────────────────────────────┐
│  POST /api/analyze   (multipart/form-data | application/json)  │
└─────────────────────────────┬──────────────────────────────────┘
                              │ text + image / audio / video
                              ▼
                       ┌─────────────┐
                       │ Rate Limit  │  IP başına dakikada 5 istek
                       └──────┬──────┘
                              │
                              ▼
                       ┌─────────────┐
                       │ Orchestrator│
                       └──────┬──────┘
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
       ┌────────────┐  ┌────────────┐  ┌────────────────┐
       │ Audio      │  │ Video      │  │ Image / Text   │
       │ Analysis   │  │ Analysis   │  │ Extraction     │
       │ Agent      │  │ Agent      │  │ Agent          │
       └─────┬──────┘  └─────┬──────┘  └───────┬────────┘
             │ transcript +  │                 │ structured
             │ vishing       │ + visual        │ extraction
             │ signals       │ signals         │ result
             └───────────────┼─────────────────┘
                             │ (media observations merge edilir)
                             ▼
                    ┌──────────────────┐
                    │ Validation Agent │
                    │  • Faz 1: Search │
                    │  • Faz 2: Tools  │
                    └────────┬─────────┘
                             │ risk scores + reasoning + evidence
                             ▼
                    ┌──────────────────┐
                    │ Judgement Agent  │
                    └────────┬─────────┘
                             │ final report (Türkçe, sade dil)
                             ▼
                    ┌──────────────────┐
                    │   JSON yanıtı    │
                    └──────────────────┘
```

### Paralel mi, sıralı mı?

- **Paralel:** Audio + Video + Image + Extraction agent'ları birbirinden bağımsız çalışır. Orchestrator bunları `Promise.all` ile birlikte başlatır.
- **Sıralı:** Validation Agent yukarıdaki tüm sonuçların birleşik çıktısına ihtiyaç duyar — extraction bittikten sonra çalışır. Judgement Agent da validation bittikten sonra çalışır.

Tipik analiz süresi (metin):
- Extraction: ~1.5–2.5 s
- Validation Faz 1 (Google Search): ~1.5–3 s
- Validation Faz 2 (Function Calling): ~2–4 s
- Judgement: ~1–2 s
- **Toplam:** ~7–12 s

Tek bir API key ile cold start daha kısadır, çoklu fonksiyon çağrısı + Google Search varsa üst sınıra yaklaşır.

---

## 3. Ajan Detayları

### 3.1 Extraction Agent

**Girdi:** ham metin ve/veya görsel base64.

**Çıktı:** `ExtractionResult` (Zod ile şema doğrulamalı).

```ts
{
  textSummary: string;          // 1–2 cümle özet
  urls: string[];               // sanitize edilmiş (markdown link temizliği)
  ibans: string[];              // TR formatı normalize edilmiş
  phones: string[];
  brandNames: string[];         // küçük/yerel markalar dahil
  senderEmails: string[];       // email screenshot'larında sender adresi
  claims: string[];             // mesajdaki iddialar
  urgencyPhrases: string[];     // baskı/aciliyet ifadeleri
  priceClaims: string[];        // ürün + fiyat iddiaları
  giveawayPhrases: string[];    // çekiliş/hediye vaatleri
  discountClaims: string[];     // indirim/kampanya iddiaları
}
```

**Prompt tasarımı:** Modele 8 kategori bilinen Türk markası örnek olarak verilir ve "atlamadan tümünü listele" talimatı vurgulanır. E-posta screenshot'larında sender adresinin gözden kaçırılmaması için ayrı bir talimat blok'u bulunur.

**Fallback:** Gemini boş veya bozuk yanıt verirse, regex tabanlı `detectUrls / detectIbans / detectPhones / detectEmails / detectUrgencyPhrases` ile kısmi çıkarım yapılır; markalar boş kalır.

### 3.2 ImageAnalysisAgent

**Tek odak:** görselin AI ile üretilmiş veya manipüle edilmiş olup olmadığı. Gemini Vision'a görsel base64 olarak verilir; çıktı `aiGeneratedRisk: 0–100` ve metin sinyalleri olarak döner. Bu sinyaller daha sonra `urgencyPhrases`'e merge edilerek validation'da deepfake risk hesabına dahil olur.

### 3.3 AudioAnalysisAgent / VideoAnalysisAgent

Gemini'ye dosya `inlineData` olarak gönderilir (15 MB sınırı). Çıktı:

```ts
{
  transcript: string;                // tam transkript
  language: string;                  // "tr", "en", ...
  riskObservations: string[];        // vishing kalıpları (audio)
  visualObservations?: string[];     // sadece video: görsel sinyaller (deepfake, sahte logo)
}
```

Eğer kullanıcı **sadece** ses/video gönderdiyse (metin yok, görsel yok), transcript ana pipeline'a `pipelineText` olarak aktarılır ve `isAudioTranscript = true` bayrağı validation'a iletilir. Bu bayrak ses ağırlık formülünü tetikler (aciliyet baskın sinyal).

### 3.4 Judgement Agent

**Tek hedef:** kullanıcı dostu son rapor.

Hedef kitle yaşlı/teknolojiden anlamayan kullanıcı olduğu için prompt'ta şu kurallar zorlanır:
- Teknik terim yasak (phishing, vishing, oltalama, malware — hiçbiri yazılmaz).
- `headline`: tek cümle, ≤ 90 karakter, net karar.
- `summary`: 2–3 cümle, mesajda geçen spesifik detaylar (marka, IBAN, URL) dahil.
- `recommendedActions`: emir kipinde, eylem odaklı, 10–20 kelime.

Risk seviyesine göre prompt'a örnek headline'lar enjekte edilir (LOW/MEDIUM/HIGH şablonu). Deepfake riski ≥ 45 ise prompt'a ayrıca "video/ses sahte olabilir, mutlaka vurgula" talimatı eklenir.

**Fallback:** Gemini bozuk/eksik veri döndürürse `fallbackHeadline / fallbackSummary / fallbackActions` ile sabit şablon kullanılır. Bu, kullanıcının her zaman okunabilir bir cevap görmesini garanti eder.

---

## 4. Validation Agent — İki Fazlı Tasarım

Validation, projenin **agentic AI** iddiasının somutlaştığı yerdir. İki fazlı bir yapı vardır.

### 4.1 Faz 1 — Google Search Doğrulama

**Amaç:** Sözlüğümüzde olmayan markalar ve kampanya iddialarını canlı internet aramasıyla doğrulamak. Hedef ikili: **resmi domain tespit etmek** (yanlış pozitif koruması) ve **sahte kampanyaları çürütmek**.

**Tetikleyici:** `brandNames`, `urls` veya `senderEmails`'ten en az biri boş değilse Faz 1 çalışır.

**Mekanizma:** Gemini'ye sadece `googleSearch` tool'u verilir (function declarations yok, çünkü Gemini API aynı çağrıda ikisini birden iyi desteklemiyor). Modelden yapısal JSON beklenir:

```ts
type BrandVerification = {
  brandImpersonation: "spoof" | "legitimate" | "unknown";
  urlVerdicts: { url: string; verdict: "official"|"spoof"|"unknown"; note: string }[];
  emailVerdicts: { email: string; verdict: "official"|"spoof"|"unknown"; note: string }[];
  summary: string;
};
```

**Grounding metadata yakalama:** Gemini'nin yaptığı arama sorguları `response.candidates[0].groundingMetadata.webSearchQueries` üzerinden çekilir ve validation çıktısına `webSearchQueries: string[]` olarak eklenir. UI'da "Gemini canlı şu aramaları yaptı" diye gösterilebilir.

**Hata toleransı:** Faz 1'in herhangi bir hatası (JSON parse, ağ, model) `EMPTY_VERIFICATION` olarak yutulur — Faz 2 yine çalışır, ama "search override" devreye girmez (deterministik heuristikler tam güç uygulanır).

### 4.2 Faz 2 — Function Calling

**Amaç:** Spesifik teknik kontrolleri (domain yaşı, IBAN checksum, URL güvenliği) Gemini'ye karar verdirip yaptırmak.

**Mekanizma:** İlk istek tool tanımlarıyla gönderilir. Gemini hangi araçları çağıracağına kendi karar verir. Çağrılar **paralel çalıştırılır** (`Promise.all`). Sonuçlar Gemini'ye geri gönderilir; ikinci istekte Gemini final JSON skorlarını üretir.

```
Gemini → "Bu URL için domain yaşına bakmam lazım"
       → check_domain_age({"domain": "ziraat-giris.xyz"})
ŞüpheKalkanı yürütür → RDAP'a istek → "0 gün eski"
       ↓
Gemini'ye geri → "RDAP sonuç: yeni domain"
Gemini final JSON → { urlRisk: 90, brandSpoofRisk: 100, ... }
```

Faz 1'in `BrandVerification` çıktısı Faz 2 prompt'una okunur metin olarak ("URL X → official", "URL Y → spoof" gibi) enjekte edilir, böylece Gemini Faz 2'de karar verirken Faz 1'in bulgularını da kullanabilir.

### 4.3 Çıktı

```ts
type ValidationResult = {
  urlRisk: number;          // 0–100
  ibanRisk: number;
  urgencyRisk: number;
  brandSpoofRisk: number;
  ecommerceRisk: number;
  deepfakeRisk: number;
  deepfakeSignals: string[];
  redFlags: string[];       // sade Türkçe açıklamalar
  reasoning: string;        // Gemini'nin değerlendirme metni
  webSearchQueries: string[];  // agentic kanıt
  toolCalls: string[];         // agentic kanıt
};
```

---

## 5. Risk Hesaplama Boru Hattı

Her risk boyutu **iki kaynaktan** beslenir ve `Math.max` ile birleştirilir.

### 5.1 Deterministik kurallar

| Boyut | Deterministik kaynak |
|---|---|
| URL Riski | `calculateUrlRisk` — TLD, kısaltma servisi, HTTPS yokluğu |
| IBAN Riski | `calculateIbanRisk` — IBAN tespit edilmişse 75 |
| Aciliyet Riski | `calculateUrgencyRisk` — `urgencyPhrases` sayısı × 20 |
| Marka Taklidi | `checkDomainSpoof` + `checkEmailDomainSpoof` — sözlük tabanlı typosquatting + heuristik |
| E-Ticaret Riski | `calculateEcommerceRisk` — fiyat anomalisi (sözlük: ~30 ürün için piyasa fiyatları), çekiliş kalıpları, %70+ indirim |
| Deepfake Riski | `detectDeepfakeSignals` — güçlü/orta/hedge'li kalıpları taranır |

### 5.2 Gemini değerlendirmesi

Faz 2'de Gemini kendi `urlRisk / ibanRisk / urgencyRisk / brandSpoofRisk` skorlarını üretir. Deterministik kuralların skoruyla `Math.max` ile birleştirilir.

Bu tasarımın amacı: **Gemini deterministik bir kuralın bulduğu riski indiremez.** Sözlük "bu URL bilinen bir typosquatting" diyorsa, Gemini "olabilir, emin değilim" demesi durumunda risk yine de yüksek kalır.

Tek istisna: **search override** (bkz. §6).

### 5.3 Ağırlıklı skor + bonus

Final skor `calculateFinalScore`'da hesaplanır. README'deki tablo formülün özetidir; tam mantık `src/lib/utils/riskHelpers.ts` içindedir.

---

## 6. Yanlış Pozitif Koruması — "Search Override"

Bu projenin **en kritik tasarım kararıdır**.

### Problem

Sözlük tabanlı kurallar şöyle der: "Mesajda 'Trendyol' geçiyor + bir URL var → marka taklidi şüphesi = 60 puan." Ama gerçek Trendyol kargo bildirimi de bu şablona uyar. Yanlış pozitif: gerçek bir kurumsal e-posta HIGH risk olarak işaretlenir.

### Çözüm

`computeBrandRisk` fonksiyonu iki tür spoof riskini ayırır:

- **`concreteSpoof`:** somut kanıt — sözlükteki marka adı URL hostname'inde geçiyor ama resmi domain değil (`ziraatbank-giris.xyz` gibi), veya e-posta domain'i resmi alanına ait değil. Bu **her zaman** sayılır.
- **`heuristic`:** sezgisel — "marka + URL bir arada" (60 puan) ve "marka + aciliyet" (40 puan). Bu skor **Faz 1 markayı `legitimate` doğruladıysa iptal edilir.**

```ts
const heuristic = !brandConfirmedLegit
  ? coexistenceRisk + impersonationRisk
  : 0;

const brandSpoofRisk = Math.max(concreteSpoof, heuristic);
```

Yani:

- Sahte Trendyol (`trendyol-kampanya.xyz`): Faz 1 → `spoof` → heuristic uygulanır + concreteSpoof zaten yakaladı → 100.
- Gerçek Trendyol (`trendyol.com`): Faz 1 → `legitimate` → heuristic iptal → concreteSpoof = 0 → toplam 0.

Aynı mantık URL'ler için `urlVerdicts`'ten gelen "official" işaretine bakılarak `urlRisk`'e de uygulanır. Faz 1 resmi olarak doğruladığı URL'lerin TLD/yapı heuristik skorları suppress edilir.

### Faz 1 başarısızsa?

`EMPTY_VERIFICATION` döner → `brandConfirmedLegit = false` → heuristik **tam güç** uygulanır. Bu konservatif default: "kanıt yoksa şüphe et."

---

## 7. Function Calling Mimarisi

Üç araç `SECURITY_TOOL_DECLARATIONS` altında Gemini'ye tanıtılır. Her birinin implementasyonu `src/lib/tools/securityTools.ts` içinde.

### 7.1 `check_domain_age`

```http
GET https://rdap.org/domain/{domain}
```

RDAP (WHOIS'in JSON haline gelmiş yerine geçeni) üzerinden domain tescil tarihini alır.

```ts
const ageInDays = (Date.now() - regDate) / (1000 * 60 * 60 * 24);

if (ageInDays < 30) → HIGH risk (yeni domain, tek kullanımlık dolandırıcılık sitesi tipik)
if (ageInDays < 180) → MEDIUM
else → LOW
```

API key gerekmez, ücretsiz. Timeout 4 sn; başarısız olursa `riskLevel: "UNKNOWN"` döner ve Gemini bunu yorum yaparken hesaba katar.

### 7.2 `check_iban_validity`

ISO 7064 MOD 97-10 algoritmasının doğrudan uygulaması:

1. IBAN'ın ilk 4 karakterini sona taşı.
2. Her harfi sayıya çevir (A=10, B=11, ..., Z=35).
3. Çıkan büyük sayının MOD 97 sonucu **1 olmalı**.

Uydurulmuş IBAN'ları matematiksel olarak yakalar. Türkiye IBAN'ı 26 karakter olmalı; bu da ön kontrol.

### 7.3 `check_url_safety`

API olmayan, yapısal heuristik:

| Sinyal | Risk |
|---|---|
| Şüpheli TLD (.xyz, .top, .click, .tk, ...) | +35 |
| Derin alt domain (4+ seviye) | +20 |
| Domain adında tire (-) | +25 |
| URL bir IP adresine yönlendiriyor | +50 |
| URL kısaltma servisi (bit.ly, t.co, ...) | +30 |
| HTTP (HTTPS yok) | +20 |
| URL > 120 karakter | +15 |
| Sayısal subdomain | +20 |

Toplam 100'e klamplanır.

---

## 8. Şema ve Tipler

Tüm ajan çıktıları Zod ile doğrulanır. Bu, "Gemini garip bir şey döndürdü" durumunda erken hata yakalamayı sağlar.

```
src/lib/schemas/reportSchema.ts
  ExtractionSchema    → ExtractionResult tipi
  ValidationSchema    → ValidationResult tipi
  FinalReportSchema   → FinalReport tipi
  RiskLevelSchema     → "LOW" | "MEDIUM" | "HIGH"
```

Şema değişiklikleri geriye uyumlu yapılır: yeni alanlar `.optional().default(...)` ile eklenir, eski çağıranlar etkilenmez.

---

## 9. Dayanıklılık Mekanizmaları

### 9.1 Çoklu API Anahtar Rotasyonu

`src/lib/gemini/client.ts` içindeki wrapper, `GEMINI_API_KEY` ile `GEMINI_API_KEY_2..10` arasındaki anahtarları tarar. Bir anahtar 429 (kota) hatası alırsa, sıradakine geçilir. Başarılı çağrı sonrası `currentKeyIndex` güncellenir — bir sonraki istek aynı anahtardan başlar (gereksiz rotasyon yok).

```
Key #1 quota dolu → Key #2 dene → Key #2 başarılı → currentKeyIndex = 2
Sonraki istek Key #2'den başlar
```

Quota dışı hatalar (timeout, 503, 5xx) anında fırlatılır — başka anahtar denemez.

### 9.2 503 Retry

Gemini servisi anlık aşırı yüklenirse exponential backoff ile 3 deneme:
- Deneme 1: 700 ms bekle
- Deneme 2: 1.4 s bekle
- Deneme 3: 2.8 s bekle

Hâlâ 503 ise `GeminiUnavailableError` fırlatılır.

### 9.3 Dürüst Hata Yönetimi

Bu projenin önemli bir felsefik kararı: **API erişilemediğinde sahte güvenli sonuç üretmek tehlikelidir.** Bir saldırgan API'yi yorabilir ve sistem `LOW` döndürebilir; kullanıcı tuzağa düşer.

Bu yüzden `GeminiUnavailableError`:
- Tüm API anahtarları quota doldurduğunda fırlatılır.
- Gemini boş yanıt verdiğinde fırlatılır.
- Gemini bozuk JSON döndürdüğünde fırlatılır.
- Validation agent'ın outer catch'i bu hatayı **yutmaz**, yukarı iletir.
- Route handler 503 HTTP yanıtıyla "analiz yapılamadı, lütfen tekrar deneyin" mesajı döner.

### 9.4 Rate Limit

`src/lib/utils/rateLimit.ts` — in-memory IP bazlı sayaç. Bir IP'den dakikada en fazla 5 analiz. Aşılırsa 429.

---

## 10. Tasarım Kararları

### Neden tek prompt yerine ajan zinciri?

- **Sorumluluk ayrımı:** Extraction sadece çıkarır, validation sadece skorlar. Her ajan kendi konusunda daha iyi.
- **Hata izolasyonu:** Bir ajan başarısız olursa diğerleri etkilenmez.
- **Şema doğrulaması:** Her ajanın çıktısı tipli ve doğrulanabilir.
- **Agentic iddianın somutluğu:** Validation Agent'ın iki fazlı yapısı + function calling, "LLM wrapper'dan fazlasıyız" iddiasını kanıtlar.

### Neden Faz 1'i ayrı bir çağrı yaptık?

Gemini API'sinde `googleSearch` ve `functionDeclarations` tool'larını **aynı çağrıda** birlikte kullanmak güvenilir değil — model bazen sadece arıyor, bazen sadece function call yapıyor. İkisini ayrı fazlara bölmek deterministik çalışmayı garanti eder.

Maliyet: bir ekstra Gemini çağrısı (~1.5–3 s). Faydası: Faz 1 yapısal JSON döndürdüğü için yanlış pozitif override mantığı çalışabilir.

### Neden deterministik + LLM hibrit?

- **Deterministik kurallar** açıklanabilir ve test edilebilir — "IBAN checksum hatalı = geçersiz" net.
- **LLM** bağlam okur — "Trendyol Black Friday kampanyası iPhone 999 TL, bu gerçek mi?" sorusuna sadece deterministik kurallarla cevap veremezsiniz.
- **`Math.max` ile birleşim** — biri katı (deterministik), biri esnek (LLM). Birinin yakaladığı diğeri tarafından azaltılamaz.

### Neden yaşlı kullanıcılar hedef kitle?

İstatistik: Türkiye'de dolandırıcılık mağdurlarının önemli bir kısmı **65+ yaş grubu**. Bu yaş grubu teknik terim ("phishing", "URL", "deepfake") tanımıyor. Tüm Judgement Agent prompt'ları "10 yaşında bir çocuğun anlayacağı dil" kuralıyla yazılmıştır. Teknik detaylar UI'da accordion ardında saklı.

---

İlgili dokümanlar:

- [README.md](../README.md) — yüksek seviye proje tanıtımı
- [docs/AGENTIC_PROOF.md](AGENTIC_PROOF.md) — agentic davranışın gerçek log örnekleri
