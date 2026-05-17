import { ai } from "@/lib/gemini/client";
import {
  calculateEcommerceRisk,
  calculateIbanRisk,
  calculateUrgencyRisk,
  calculateUrlRisk,
  checkDomainSpoof,
  detectFakeDiscountPhrases,
  detectGiveawayPhrases,
  detectPricingAnomalies,
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

type GeminiValidationOutput = {
  urlRisk: number;
  ibanRisk: number;
  urgencyRisk: number;
  brandSpoofRisk: number;
  additionalRedFlags: string[];
  reasoning: string;
  webSearchQueries: string[];
  toolCalls: string[];
};

function cleanJson(text: string) {
  return text.replace(/```json/g, "").replace(/```/g, "").trim();
}

function safeScore(val: unknown): number {
  const n = Number(val);
  return isNaN(n) ? 0 : Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Gemini ile agentic doğrulama — function calling loop.
 *
 * Akış:
 *  1. Extraction verisi + deterministik ön skorlar Gemini'ye gönderilir,
 *     3 araç tanımı da eklenir (domain yaşı, IBAN checksum, URL güvenlik).
 *  2. Gemini gerekli araçları çağırır (URL varsa check_domain_age + check_url_safety,
 *     IBAN varsa check_iban_validity).
 *  3. Araç çağrıları paralel olarak çalıştırılır.
 *  4. Sonuçlar Gemini'ye geri gönderilir.
 *  5. Gemini nihai risk skorlarını ve red flag'leri JSON olarak döndürür.
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
  // FAZ 1: Google Search ile marka doğrulama
  // (Sadece marka adı varsa ve gerekli görüyorsak)
  // ─────────────────────────────────────────────
  const webSearchQueries: string[] = [];
  let brandVerificationNotes = "";

  if (data.brandNames.length > 0) {
    try {
      const brandPrompt = `Aşağıdaki içerikte geçen markaları ve iddiaları Google üzerinden DOĞRULA.

Markalar: ${data.brandNames.join(", ")}
${data.urls.length > 0 ? `Mesajdaki URL'ler: ${data.urls.join(", ")}` : ""}
İçerik özeti: ${data.textSummary}
${data.claims.length > 0 ? `İddialar: ${data.claims.join("; ")}` : ""}

Şunları araştır:
1. Her marka için RESMİ web sitesini bul (örn: "[marka adı] resmi site").
2. URL'lerdeki domain, markanın resmi domaini mi karşılaştır.
3. İçerikteki kampanya/indirim/çekiliş iddiası gerçek mi (örn: "[marka] [kampanya] gerçek mi").

Sadece düz metin yanıt ver (max 4 cümle). Şunu içersin:
- Resmi domain(ler) ne?
- URL eşleşiyor mu yoksa SAHTE mi?
- Kampanya iddiası varsa: gerçek mi?`;

      const brandResp = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: brandPrompt }] }],
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const groundingMeta = brandResp.candidates?.[0]?.groundingMetadata;
      const queries = groundingMeta?.webSearchQueries ?? [];
      webSearchQueries.push(...queries);
      brandVerificationNotes = brandResp.text ?? "";

      if (queries.length > 0) {
        console.log(
          `[ValidationAgent] Faz 1 — Google'da ${queries.length} arama yapıldı:`,
          queries
        );
        console.log(
          "[ValidationAgent] Marka doğrulama özeti:",
          brandVerificationNotes.slice(0, 200)
        );
      }
    } catch (err) {
      console.error("[ValidationAgent] Faz 1 (Google Search) hata:", err);
    }
  }

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

  if (!finalText) throw new Error("Gemini boş cevap döndürdü");

  const parsed = JSON.parse(cleanJson(finalText));

  return {
    urlRisk: safeScore(parsed.urlRisk),
    ibanRisk: safeScore(parsed.ibanRisk),
    urgencyRisk: safeScore(parsed.urgencyRisk),
    brandSpoofRisk: safeScore(parsed.brandSpoofRisk),
    additionalRedFlags: Array.isArray(parsed.additionalRedFlags)
      ? parsed.additionalRedFlags.filter((f: unknown) => typeof f === "string")
      : [],
    reasoning:
      typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    webSearchQueries,
    toolCalls: toolCallNames,
  };
}

export async function validationAgent(
  data: ExtractionResult,
  isAudioTranscript = false
) {
  console.log("Validation Agent çalıştı");

  // Step 1: Deterministik araçlar — hızlı ve güvenilir temel ölçüm
  const urlRisk = calculateUrlRisk(data.urls);
  const ibanRisk = calculateIbanRisk(data.ibans);
  const urgencyRisk = calculateUrgencyRisk(data.urgencyPhrases);

  const hasBrand = data.brandNames.length > 0;
  const hasUrl = data.urls.length > 0;
  const hasUrgency = data.urgencyPhrases.length > 0;

  // Domain spoof kontrolü: bilinen kurumların typosquatting tespiti
  const domainSpoofRisk = checkDomainSpoof(data.brandNames, data.urls);
  const impersonationRisk = hasBrand && hasUrgency ? 40 : 0;

  const baseBrandRisk =
    domainSpoofRisk > 0 ? domainSpoofRisk : hasBrand && hasUrl ? 60 : 0;
  const deterministicBrandSpoofRisk = Math.min(
    100,
    baseBrandRisk + impersonationRisk
  );

  // E-ticaret sinyalleri — Gemini extraction'dan gelen + kendi detektörümüzle birleştir
  const pricingAnomaliesFromText = detectPricingAnomalies(data.textSummary);
  const giveawayFromText = detectGiveawayPhrases(data.textSummary);
  const discountFromText = detectFakeDiscountPhrases(data.textSummary);

  // Gemini extraction'ın bulduklarını da fiyat anomalisi açısından tara
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

  const preliminary = {
    urlRisk,
    ibanRisk,
    urgencyRisk,
    brandSpoofRisk: deterministicBrandSpoofRisk,
  };

  // Step 2: Gemini + Function Calling — gerçek zamanlı araç tabanlı analiz
  let finalRisks = { ...preliminary };
  let reasoning: string | undefined;
  let webSearchQueries: string[] = [];
  let toolCalls: string[] = [];
  const redFlags: string[] = [];

  try {
    const gemini = await geminiReasoningWithFunctionCalling(
      data,
      preliminary,
      isAudioTranscript
    );

    // Gemini skoru ile deterministik skoru karşılaştır, yükseği al
    finalRisks = {
      urlRisk: Math.max(urlRisk, gemini.urlRisk),
      ibanRisk: Math.max(ibanRisk, gemini.ibanRisk),
      urgencyRisk: Math.max(urgencyRisk, gemini.urgencyRisk),
      brandSpoofRisk: Math.max(deterministicBrandSpoofRisk, gemini.brandSpoofRisk),
    };

    reasoning = gemini.reasoning;
    webSearchQueries = gemini.webSearchQueries;
    toolCalls = gemini.toolCalls;
    redFlags.push(...gemini.additionalRedFlags);
  } catch (error) {
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

  // E-ticaret red flag'leri
  if (allPricingAnomalies.length > 0) {
    redFlags.push(
      `Gerçekçi olmayan fiyat: ${allPricingAnomalies[0]}`
    );
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
    redFlags: uniqueRedFlags,
    reasoning,
    webSearchQueries: webSearchQueries.length > 0 ? webSearchQueries : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  });
}
