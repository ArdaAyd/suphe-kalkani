import { ai, GeminiUnavailableError } from "@/lib/gemini/client";
import {
  calculateEcommerceRisk,
  calculateIbanRisk,
  calculateUrgencyRisk,
  calculateUrlRisk,
  checkDomainSpoof,
  checkEmailDomainSpoof,
  detectDeepfakeSignals,
  detectFakeDiscountPhrases,
  detectGiveawayPhrases,
  detectPricingAnomalies,
  extractHostname,
} from "@/lib/utils/riskHelpers";
import {
  ValidationSchema,
  type ExtractionResult,
} from "@/lib/schemas/reportSchema";
import {
  SECURITY_TOOL_DECLARATIONS,
  executeToolCall,
} from "@/lib/tools/securityTools";
import type { Content, Part } from "@google/genai";

// ─────────────────────────────────────────────
// Tipler
// ─────────────────────────────────────────────

type DomainVerdict = {
  value: string;
  verdict: "official" | "spoof" | "unknown";
  note: string;
};

/**
 * Faz 1'de Google Search ile yapılan yapısal URL / marka / e-posta doğrulaması.
 *
 * Serbest metin yerine yapısal verdict üretilir; bu sayede deterministik
 * sözlük tabanlı kontrollerin yarattığı yanlış pozitifler (örn. resmi ama
 * sözlükte olmayan bir domain) search sonucuna göre geri alınabilir.
 */
type BrandVerification = {
  brandImpersonation: "spoof" | "legitimate" | "unknown";
  urlVerdicts: DomainVerdict[];
  emailVerdicts: DomainVerdict[];
  summary: string;
};

const EMPTY_VERIFICATION: BrandVerification = {
  brandImpersonation: "unknown",
  urlVerdicts: [],
  emailVerdicts: [],
  summary: "",
};

type GeminiValidationOutput = {
  urlRisk: number;
  ibanRisk: number;
  urgencyRisk: number;
  brandSpoofRisk: number;
  additionalRedFlags: string[];
  reasoning: string;
  webSearchQueries: string[];
  toolCalls: string[];
  verification: BrandVerification;
};

function cleanJson(text: string) {
  return text.replace(/```json/g, "").replace(/```/g, "").trim();
}

function safeScore(val: unknown): number {
  const n = Number(val);
  return isNaN(n) ? 0 : Math.max(0, Math.min(100, Math.round(n)));
}

/** URL'leri host bazında eşleştirmek için anahtar (protokol ve "www." atılır). */
function urlKey(u: string): string {
  return extractHostname(u).replace(/^www\./, "");
}

/** Faz 1 Google Search yanıtını yapısal BrandVerification'a çevirir. */
function parseVerification(raw: string): BrandVerification {
  try {
    // googleSearch yanıtı JSON'un başına/sonuna metin ekleyebilir — bloğu ayıkla
    const cleaned = cleanJson(raw);
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    const jsonStr =
      first !== -1 && last > first ? cleaned.slice(first, last + 1) : cleaned;
    const parsed = JSON.parse(jsonStr);

    const normVerdict = (v: unknown): DomainVerdict["verdict"] =>
      v === "official" || v === "spoof" ? v : "unknown";

    const mapVerdicts = (
      arr: unknown,
      key: "url" | "email"
    ): DomainVerdict[] => {
      if (!Array.isArray(arr)) return [];
      return arr
        .map((x): DomainVerdict => {
          const o = (x ?? {}) as Record<string, unknown>;
          return {
            value: typeof o[key] === "string" ? (o[key] as string) : "",
            verdict: normVerdict(o.verdict),
            note: typeof o.note === "string" ? (o.note as string) : "",
          };
        })
        .filter((v) => v.value.length > 0);
    };

    const bi = parsed.brandImpersonation;

    return {
      brandImpersonation:
        bi === "spoof" || bi === "legitimate" ? bi : "unknown",
      urlVerdicts: mapVerdicts(parsed.urlVerdicts, "url"),
      emailVerdicts: mapVerdicts(parsed.emailVerdicts, "email"),
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
    };
  } catch {
    return EMPTY_VERIFICATION;
  }
}

/** BrandVerification'ı Faz 2 prompt'una eklenecek okunur metne çevirir. */
function buildVerificationNotes(v: BrandVerification): string {
  const lines: string[] = [];
  if (v.summary) lines.push(v.summary);
  lines.push(`Marka taklidi değerlendirmesi: ${v.brandImpersonation}`);
  for (const u of v.urlVerdicts) {
    lines.push(`URL ${u.value} → ${u.verdict}${u.note ? ` (${u.note})` : ""}`);
  }
  for (const e of v.emailVerdicts) {
    lines.push(
      `E-posta ${e.value} → ${e.verdict}${e.note ? ` (${e.note})` : ""}`
    );
  }
  return lines.join("\n");
}

/**
 * Deterministik marka taklidi (brand spoof) riski.
 *
 * - concreteSpoof: typosquatting / sahte e-posta domaini gibi SOMUT kanıt —
 *   her zaman sayılır.
 * - heuristic: "marka + URL bir arada" (60) ve "marka + aciliyet" (40) gibi
 *   SEZGİSEL zemin riskleri. Google araması markayı "legitimate" doğruladıysa
 *   (brandConfirmedLegit) bu zemin riskleri uygulanmaz.
 */
function computeBrandRisk(
  brandNames: string[],
  urls: string[],
  emails: string[],
  hasUrgency: boolean,
  brandConfirmedLegit: boolean
): { brandSpoofRisk: number; emailSpoofDetails: string[] } {
  const hasBrand = brandNames.length > 0;
  const hasUrl = urls.length > 0;

  const domainSpoofRisk = checkDomainSpoof(brandNames, urls);
  const emailSpoofCheck = checkEmailDomainSpoof(brandNames, emails);
  const concreteSpoof = Math.max(domainSpoofRisk, emailSpoofCheck.risk);

  const impersonationRisk =
    !brandConfirmedLegit && hasBrand && hasUrgency ? 40 : 0;
  const coexistenceRisk =
    !brandConfirmedLegit && hasBrand && hasUrl ? 60 : 0;
  const heuristic = Math.min(100, coexistenceRisk + impersonationRisk);

  return {
    brandSpoofRisk: Math.max(concreteSpoof, heuristic),
    emailSpoofDetails: emailSpoofCheck.details,
  };
}

/**
 * Gemini ile agentic doğrulama.
 *
 * Faz 1 — Google Search:
 *   İçerikteki URL / marka / e-posta adresleri canlı arama ile doğrulanır ve
 *   yapısal bir BrandVerification (her domain için official/spoof/unknown)
 *   üretilir. Bu, deterministik yanlış pozitifleri geri almak için kullanılır.
 *
 * Faz 2 — Function Calling:
 *   Extraction verisi + ön skorlar + Faz 1 bulguları Gemini'ye gönderilir;
 *   Gemini domain yaşı / IBAN checksum / URL güvenlik araçlarını çağırır ve
 *   nihai risk skorlarını JSON olarak döndürür.
 */
async function geminiReasoningWithFunctionCalling(
  data: ExtractionResult,
  preliminary: {
    urlRisk: number;
    ibanRisk: number;
    urgencyRisk: number;
    brandSpoofRisk: number;
  },
  isAudioTranscript = false
): Promise<GeminiValidationOutput> {
  const sourceContext = isAudioTranscript
    ? "⚠️ Bu içerik bir ses kaydının transkribidir. Sesli dolandırıcılık (vishing) kalıplarına dikkat et: baskı kurma, sahte yetkili kimliği, telefon/hesap numarası talepleri, acele kararlar."
    : "Bu içerik bir metin veya görsel analizden elde edilmiştir.";

  // ─────────────────────────────────────────────
  // FAZ 1: Google Search ile yapısal URL / marka / e-posta doğrulama
  // ─────────────────────────────────────────────
  const webSearchQueries: string[] = [];
  let verification: BrandVerification = EMPTY_VERIFICATION;

  const hasVerifiableEntities =
    data.brandNames.length > 0 ||
    (data.senderEmails ?? []).length > 0 ||
    data.urls.length > 0;

  if (hasVerifiableEntities) {
    try {
      const verifyPrompt = `Aşağıdaki şüpheli içerikte geçen URL, marka ve e-posta adreslerini Google araması yaparak DOĞRULA.

Markalar: ${data.brandNames.length > 0 ? data.brandNames.join(", ") : "yok"}
URL'ler: ${data.urls.length > 0 ? data.urls.join(", ") : "yok"}
Gönderici e-posta(lar): ${(data.senderEmails ?? []).length > 0 ? (data.senderEmails ?? []).join(", ") : "yok"}
İçerik özeti: ${data.textSummary}

Görevin: Google'da arama yaparak her URL ve her e-posta adresinin, ilgili markanın GERÇEK ve RESMİ mülkü mü yoksa taklit/sahte mi olduğunu belirle.

ÇOK ÖNEMLİ:
- Bir markanın birden fazla resmi domaini ve alt alan adı olabilir; hepsi resmidir.
  Örnek: yapikredi.com.tr, yapikrediplay.com.tr, yukle.yapikredi.com → hepsi Yapı Kredi'ye aittir, RESMİDİR.
  Örnek: news@email.trendyol.com → trendyol.com'a ait bir alt alan, RESMİDİR.
- Marka adını taklit eden ama markaya ait olmayan ayrı domainler sahtedir.
  Örnek: ziraatbank-giris.com, guvenbank-destek-mail.com, apple-kampanya-tr.com → SAHTE.
- Kararından emin değilsen "unknown" de; tahmin yürütme.

Her giriş için verdict:
- "official": Google araması bu domain/e-postanın markanın gerçek resmi mülkü olduğunu gösteriyor.
- "spoof": markayı taklit ediyor ama resmi değil.
- "unknown": net karar verilemedi.

brandImpersonation:
- "legitimate": içerikteki tüm marka kullanımı meşru, taklit yok.
- "spoof": bir marka taklit ediliyor.
- "unknown": karar verilemedi.

SADECE şu JSON'u döndür, markdown veya ek açıklama EKLEME:
{
  "brandImpersonation": "spoof" | "legitimate" | "unknown",
  "urlVerdicts": [{ "url": "<url>", "verdict": "official|spoof|unknown", "note": "kısa Türkçe gerekçe" }],
  "emailVerdicts": [{ "email": "<email>", "verdict": "official|spoof|unknown", "note": "kısa Türkçe gerekçe" }],
  "summary": "1-2 cümle Türkçe özet"
}`;

      const verifyResp = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: verifyPrompt }] }],
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const groundingMeta = verifyResp.candidates?.[0]?.groundingMetadata;
      webSearchQueries.push(...(groundingMeta?.webSearchQueries ?? []));
      verification = parseVerification(verifyResp.text ?? "");

      console.log("[ValidationAgent] Faz 1 — Google doğrulama:", {
        queries: webSearchQueries,
        brandImpersonation: verification.brandImpersonation,
        urlVerdicts: verification.urlVerdicts.map(
          (v) => `${v.value}:${v.verdict}`
        ),
        emailVerdicts: verification.emailVerdicts.map(
          (v) => `${v.value}:${v.verdict}`
        ),
      });
    } catch (err) {
      // API tamamen kullanılamıyorsa (kota/aşırı yük) yutma — yukarı ilet.
      // Faz 1 olmadan search override çalışmaz; meşru içerik yanlış pozitif alır.
      if (err instanceof GeminiUnavailableError) throw err;
      console.error("[ValidationAgent] Faz 1 (Google Search) hata:", err);
    }
  }

  const brandVerificationNotes = buildVerificationNotes(verification);

  // ─────────────────────────────────────────────
  // FAZ 2: Function Calling ile detaylı analiz
  // ─────────────────────────────────────────────
  const prompt = `Sen bir siber güvenlik uzmanısın. Şüpheli içerikten çıkarılan veriler ve deterministik araçların ürettiği ön risk skorları aşağıda verilmiştir.

${sourceContext}

Çıkarılan Veriler:
- URL'ler: ${data.urls.length > 0 ? data.urls.join(", ") : "yok"}
- IBAN'lar: ${data.ibans.length > 0 ? data.ibans.join(", ") : "yok"}
- Marka / Kurum Adları: ${data.brandNames.length > 0 ? data.brandNames.join(", ") : "yok"}
- Aciliyet İfadeleri: ${data.urgencyPhrases.length > 0 ? data.urgencyPhrases.join(", ") : "yok"}
- İçerik Özeti: ${data.textSummary}

Deterministik Araç Sonuçları (0-100):
- URL Riski: ${preliminary.urlRisk}
- IBAN Riski: ${preliminary.ibanRisk}
- Aciliyet Riski: ${preliminary.urgencyRisk}
- Marka Taklidi Riski: ${preliminary.brandSpoofRisk}

${brandVerificationNotes ? `Marka Doğrulama Bulguları (Google ile araştırıldı):\n${brandVerificationNotes}\n` : ""}

Kullanabileceğin Araçlar:
• check_domain_age(domain) → domainin RDAP üzerinden yaşını öğrenir
• check_url_safety(url) → URL'in TLD/yapısal güvenlik analizini yapar
• check_iban_validity(iban) → IBAN'ın matematiksel geçerliliğini doğrular

Görevin:
1. Eğer URL varsa: her URL için check_domain_age VE check_url_safety çağır.
2. Eğer IBAN varsa: her IBAN için check_iban_validity çağır.
3. Marka doğrulama bulgularını ve araç sonuçlarını birleştir.
4. ÖNEMLİ: Marka doğrulamasında bir URL/e-posta "official" işaretlendiyse onu resmi/güvenli kabul et ve ilgili risk skorunu DÜŞÜK ver; deterministik ön skor yüksek olsa bile. "spoof" işaretliyse riski yüksek tut.

Bilinen Türk markaları:
- Bankalar: ziraatbank.com.tr, garantibbva.com.tr, isbank.com.tr, akbank.com, yapikredi.com.tr
- Kargo: ptt.gov.tr, arasshipping.com, yurticikargo.com, mngkargo.com.tr
- E-ticaret: trendyol.com, hepsiburada.com, n11.com, amazon.com.tr
- Devlet: e-devlet.gov.tr, turkiye.gov.tr

ÇOK ÖNEMLİ — Çıktı formatı:
Araçları çağırdıktan sonra, SADECE aşağıdaki JSON'u döndür. Markdown veya açıklama EKLEME:

{
  "urlRisk": <0-100>,
  "ibanRisk": <0-100>,
  "urgencyRisk": <0-100>,
  "brandSpoofRisk": <0-100>,
  "additionalRedFlags": ["tespit ettiğin ek kırmızı bayraklar, Türkçe"],
  "reasoning": "1-2 cümle Türkçe analiz özeti (araç + Google arama bulgularını dahil et)"
}`;

  const initialContents: Content[] = [
    { role: "user", parts: [{ text: prompt }] },
  ];

  // Adım 1: İlk çağrı — araçlar tanımlı olarak gönder
  const response1 = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: initialContents,
    config: {
      tools: [{ functionDeclarations: SECURITY_TOOL_DECLARATIONS }],
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const functionCalls = response1.functionCalls;
  const toolCallNames: string[] = [];
  let finalText: string | undefined;

  if (functionCalls && functionCalls.length > 0) {
    console.log(
      `[ValidationAgent] Faz 2 — Gemini ${functionCalls.length} araç çağırdı:`,
      functionCalls.map((c) => `${c.name}(${JSON.stringify(c.args)})`)
    );
    toolCallNames.push(
      ...functionCalls.map((c) => `${c.name}(${JSON.stringify(c.args)})`)
    );

    // Adım 2: Tüm araç çağrılarını paralel çalıştır
    const toolResults = await Promise.all(
      functionCalls.map((call) =>
        executeToolCall(call.name!, call.args as Record<string, unknown>)
      )
    );

    console.log("[ValidationAgent] Araç sonuçları:", toolResults);

    // Model'in function call mesajını geçmişe ekle
    const modelParts: Part[] = functionCalls.map((call) => ({
      functionCall: call,
    }));

    // Araç yanıtlarını hazırla
    const responseParts: Part[] = functionCalls.map((call, i) => ({
      functionResponse: {
        name: call.name,
        response: toolResults[i],
      },
    }));

    // Adım 3: Araç sonuçlarıyla ikinci çağrı
    const response2 = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        ...initialContents,
        { role: "model", parts: modelParts },
        { role: "user", parts: responseParts },
      ],
      config: {
        tools: [{ functionDeclarations: SECURITY_TOOL_DECLARATIONS }],
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    finalText = response2.text;
  } else {
    // Araç çağrısı yoksa (örn: URL/IBAN yok) direkt metin yanıtı
    finalText = response1.text;
  }

  if (!finalText) {
    // Boş cevap = Gemini bu sorgu için kullanılamaz. Sessizce deterministik
    // fallback'e düşmek yerine 503 ile dürüst hata dön (commit ccc342f felsefesi).
    throw new GeminiUnavailableError(
      "Gemini doğrulama agent'ı boş cevap döndürdü."
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleanJson(finalText));
  } catch (err) {
    // Malformed JSON = güvenilmez Gemini çıktısı. Skor üretmek yerine hata fırlat.
    throw new GeminiUnavailableError(
      `Gemini doğrulama çıktısı JSON olarak parse edilemedi: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const additionalRedFlags: string[] = Array.isArray(parsed.additionalRedFlags)
    ? (parsed.additionalRedFlags as unknown[]).filter(
        (f): f is string => typeof f === "string"
      )
    : [];

  return {
    urlRisk: safeScore(parsed.urlRisk),
    ibanRisk: safeScore(parsed.ibanRisk),
    urgencyRisk: safeScore(parsed.urgencyRisk),
    brandSpoofRisk: safeScore(parsed.brandSpoofRisk),
    additionalRedFlags,
    reasoning:
      typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    webSearchQueries,
    toolCalls: toolCallNames,
    verification,
  };
}

export async function validationAgent(
  data: ExtractionResult,
  isAudioTranscript = false,
  mediaDeepfakeRisk = 0
) {
  console.log("Validation Agent çalıştı");

  // ─────────────────────────────────────────────
  // Step 1: Deterministik ön skorlar (search override öncesi)
  // ─────────────────────────────────────────────
  const ibanRisk = calculateIbanRisk(data.ibans);
  const urgencyRisk = calculateUrgencyRisk(data.urgencyPhrases);
  const hasUrl = data.urls.length > 0;
  const hasUrgency = data.urgencyPhrases.length > 0;
  const senderEmails = data.senderEmails ?? [];

  const preUrlRisk = calculateUrlRisk(data.urls);
  const preBrand = computeBrandRisk(
    data.brandNames,
    data.urls,
    senderEmails,
    hasUrgency,
    false
  );

  // E-ticaret sinyalleri — Gemini extraction'dan gelen + kendi detektörümüzle birleştir
  const pricingAnomaliesFromText = detectPricingAnomalies(data.textSummary);
  const giveawayFromText = detectGiveawayPhrases(data.textSummary);
  const discountFromText = detectFakeDiscountPhrases(data.textSummary);

  const pricingAnomaliesFromExtraction = (data.priceClaims ?? []).flatMap((c) =>
    detectPricingAnomalies(c)
  );

  const allPricingAnomalies = [
    ...new Set([...pricingAnomaliesFromText, ...pricingAnomaliesFromExtraction]),
  ];
  const allGiveawayPhrases = [
    ...new Set([...giveawayFromText, ...(data.giveawayPhrases ?? [])]),
  ];
  const allDiscountClaims = [
    ...new Set([...discountFromText, ...(data.discountClaims ?? [])]),
  ];

  const ecommerceRisk = calculateEcommerceRisk(
    allPricingAnomalies,
    allGiveawayPhrases,
    allDiscountClaims,
    hasUrl
  );

  // Deepfake/AI-generated içerik tespiti — metin sinyali ile görsel ajanının
  // doğrudan skorunun yükseğini al.
  const deepfakeScanInput = [
    ...data.urgencyPhrases,
    ...data.claims,
    data.textSummary,
  ];
  const deepfakeCheck = detectDeepfakeSignals(deepfakeScanInput);
  const deepfakeRisk = Math.max(deepfakeCheck.risk, mediaDeepfakeRisk);

  const preliminary = {
    urlRisk: preUrlRisk,
    ibanRisk,
    urgencyRisk,
    brandSpoofRisk: preBrand.brandSpoofRisk,
  };

  // ─────────────────────────────────────────────
  // Step 2: Gemini (Google Search + Function Calling) + search override
  // ─────────────────────────────────────────────
  let finalRisks = { ...preliminary };
  let reasoning: string | undefined;
  let webSearchQueries: string[] = [];
  let toolCalls: string[] = [];
  let emailSpoofDetails = preBrand.emailSpoofDetails;
  const redFlags: string[] = [];

  try {
    const gemini = await geminiReasoningWithFunctionCalling(
      data,
      preliminary,
      isAudioTranscript
    );

    const verification = gemini.verification;

    // Google araması RESMİ olarak doğruladığı URL ve e-postaları belirle
    const officialUrlKeys = new Set(
      verification.urlVerdicts
        .filter((v) => v.verdict === "official")
        .map((v) => urlKey(v.value))
    );
    const officialEmails = new Set(
      verification.emailVerdicts
        .filter((v) => v.verdict === "official")
        .map((v) => v.value.toLowerCase().trim())
    );

    // Resmi doğrulananları deterministik hesaptan çıkar
    const unverifiedUrls = data.urls.filter(
      (u) => !officialUrlKeys.has(urlKey(u))
    );
    const unverifiedEmails = senderEmails.filter(
      (e) => !officialEmails.has(e.toLowerCase().trim())
    );
    const brandLegit = verification.brandImpersonation === "legitimate";

    const correctedUrlRisk = calculateUrlRisk(unverifiedUrls);
    const correctedBrand = computeBrandRisk(
      data.brandNames,
      unverifiedUrls,
      unverifiedEmails,
      hasUrgency,
      brandLegit
    );
    emailSpoofDetails = correctedBrand.emailSpoofDetails;

    // Düzeltilmiş deterministik skor ile Gemini skorunun yükseğini al
    let urlRiskFinal = Math.max(correctedUrlRisk, gemini.urlRisk);
    let brandSpoofFinal = Math.max(
      correctedBrand.brandSpoofRisk,
      gemini.brandSpoofRisk
    );

    // Tüm URL'ler / e-postalar Google ile resmi doğrulandıysa, Gemini
    // yanlışlıkla yüksek skor dönse bile bastır — search verdict'i son sözü söyler.
    if (data.urls.length > 0 && unverifiedUrls.length === 0) {
      urlRiskFinal = correctedUrlRisk;
    }
    if (
      brandLegit &&
      unverifiedUrls.length === 0 &&
      unverifiedEmails.length === 0
    ) {
      brandSpoofFinal = correctedBrand.brandSpoofRisk;
    }

    finalRisks = {
      urlRisk: urlRiskFinal,
      ibanRisk: Math.max(ibanRisk, gemini.ibanRisk),
      urgencyRisk: Math.max(urgencyRisk, gemini.urgencyRisk),
      brandSpoofRisk: brandSpoofFinal,
    };

    reasoning = gemini.reasoning;
    webSearchQueries = gemini.webSearchQueries;
    toolCalls = gemini.toolCalls;
    redFlags.push(...gemini.additionalRedFlags);

    if (officialUrlKeys.size > 0 || officialEmails.size > 0) {
      console.log(
        "[ValidationAgent] Search override uygulandı — resmi doğrulanan:",
        { urls: [...officialUrlKeys], emails: [...officialEmails] }
      );
    }
  } catch (error) {
    // API erişilemiyorsa sahte/yanıltıcı sonuç üretme — hatayı yukarı ilet
    // (route 503 döner). Search override çalışmadan deterministik skorlar
    // meşru marka + URL içeriğinde yanlış pozitif (yüksek risk) verir.
    if (error instanceof GeminiUnavailableError) throw error;
    console.error(
      "Gemini validation başarısız, deterministik sonuç kullanılıyor:",
      error
    );
  }

  // Ses kaydı özel kontrolü: link/tıklama talebi vishing belirtisi
  if (isAudioTranscript) {
    const allText = [...data.urgencyPhrases, data.textSummary]
      .join(" ")
      .toLowerCase();

    const hasLinkRequest =
      allText.includes("link") ||
      allText.includes("tıkla") ||
      allText.includes("tikla") ||
      allText.includes("click") ||
      allText.includes("bağlantı") ||
      allText.includes("adrese git") ||
      allText.includes("sms'teki") ||
      allText.includes("gönderilen");

    if (hasLinkRequest) {
      finalRisks.urlRisk = Math.max(finalRisks.urlRisk, 70);
      redFlags.push(
        "Telefon görüşmesinde link tıklama talebi — sesli kimlik avı (vishing) belirtisi."
      );
    }
  }

  // Step 3: Deterministik red flag'ler
  if (finalRisks.urlRisk > 50)
    redFlags.push("Şüpheli veya resmi olmayan bağlantı tespit edildi.");
  if (finalRisks.ibanRisk > 50)
    redFlags.push("IBAN paylaşımı içeriyor — doğrudan ödeme talebi.");
  if (finalRisks.urgencyRisk > 40)
    redFlags.push("Aciliyet baskısı oluşturmaya yönelik ifadeler mevcut.");
  if (finalRisks.brandSpoofRisk > 40)
    redFlags.push("Bilinen bir marka veya kurum taklidi şüphesi.");

  // E-posta spoof red flag'leri (search override sonrası — resmi e-postalar hariç)
  if (emailSpoofDetails.length > 0) {
    redFlags.push(...emailSpoofDetails);
  }

  // Deepfake red flag'leri
  if (deepfakeRisk >= 70) {
    redFlags.push(
      "AI ile üretilmiş / deepfake içerik tespit edildi — bu görsel veya ses yapay olabilir."
    );
  } else if (deepfakeRisk >= 45) {
    redFlags.push(
      "Yapay/manipüle içerik şüphesi — dudak senkronu veya görüntü tutarsızlığı."
    );
  }

  // E-ticaret red flag'leri
  if (allPricingAnomalies.length > 0) {
    redFlags.push(`Gerçekçi olmayan fiyat: ${allPricingAnomalies[0]}`);
  }
  if (allGiveawayPhrases.length > 0 && hasUrl) {
    redFlags.push(
      `Çekiliş/ödül vaadi + şüpheli link kombinasyonu — klasik dolandırıcılık tuzağı.`
    );
  }
  if (allDiscountClaims.length >= 2) {
    redFlags.push(
      `Yapay aciliyet ve indirim baskısı (${allDiscountClaims.slice(0, 2).join(", ")}).`
    );
  }

  const uniqueRedFlags = [...new Set(redFlags)];

  return ValidationSchema.parse({
    ...finalRisks,
    ecommerceRisk,
    deepfakeRisk,
    deepfakeSignals: deepfakeCheck.signals,
    redFlags: uniqueRedFlags,
    reasoning,
    webSearchQueries: webSearchQueries.length > 0 ? webSearchQueries : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  });
}
