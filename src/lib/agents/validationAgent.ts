import { ai } from "@/lib/gemini/client";
import {
  calculateIbanRisk,
  calculateUrgencyRisk,
  calculateUrlRisk,
  checkDomainSpoof,
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

Görevin:
1. Eğer URL varsa: her URL için önce check_domain_age, sonra check_url_safety araçlarını çağır.
2. Eğer IBAN varsa: her IBAN için check_iban_validity aracını çağır.
3. Araç sonuçlarını ve deterministik verileri birleştirerek aşağıdaki JSON'u döndür.

Özellikle dikkat et:
- URL'ler tespit edilen markalar/kurumların resmi domainleriyle uyuşuyor mu?
  (Türk bankaları: ziraatbank.com.tr, garantibbva.com.tr, isbank.com.tr, akbank.com,
   yapikredi.com.tr, halkbank.com.tr, vakifbank.com.tr)
  (Kargo: ptt.gov.tr, arasshipping.com, yurticikargo.com, mngkargo.com.tr)
  (Devlet: e-devlet.gov.tr, turkiye.gov.tr)
- Marka adı URL içinde var ama domain farklıysa (örn: ziraatbank-giris.com) bu güçlü phishing sinyalidir.
- Yeni domain + bilinen marka kombinasyonu = çok yüksek risk.

Araç sonuçlarını aldıktan sonra sadece JSON döndür, markdown kullanma:
{
  "urlRisk": <0-100>,
  "ibanRisk": <0-100>,
  "urgencyRisk": <0-100>,
  "brandSpoofRisk": <0-100>,
  "additionalRedFlags": ["tespit ettiğin ek kırmızı bayraklar, Türkçe"],
  "reasoning": "1-2 cümle Türkçe analiz özeti (araç bulgularını dahil et)"
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
  let finalText: string | undefined;

  if (functionCalls && functionCalls.length > 0) {
    console.log(
      `[ValidationAgent] Gemini ${functionCalls.length} araç çağırdı:`,
      functionCalls.map((c) => `${c.name}(${JSON.stringify(c.args)})`)
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

  const preliminary = {
    urlRisk,
    ibanRisk,
    urgencyRisk,
    brandSpoofRisk: deterministicBrandSpoofRisk,
  };

  // Step 2: Gemini + Function Calling — gerçek zamanlı araç tabanlı analiz
  let finalRisks = { ...preliminary };
  let reasoning: string | undefined;
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

  const uniqueRedFlags = [...new Set(redFlags)];

  return ValidationSchema.parse({
    ...finalRisks,
    redFlags: uniqueRedFlags,
    reasoning,
  });
}
