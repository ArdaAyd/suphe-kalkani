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

async function geminiReasoning(
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

Görevin: Bu verileri bağlamsal olarak değerlendir. Özellikle:
1. URL'ler tespit edilen markalar/kurumların resmi domainleriyle uyuşuyor mu?
   (Türk bankaları genellikle .com.tr kullanır: ziraatbank.com.tr, garantibbva.com.tr, isbank.com.tr, akbank.com, yapikredi.com.tr, halkbank.com.tr, vakifbank.com.tr)
   (Kargo: ptt.gov.tr, arasshipping.com, yurticikargo.com, mngkargo.com.tr)
   (Devlet: e-devlet.gov.tr, turkiye.gov.tr)
2. Marka adı URL içinde var ama domain farklıysa (örn: ziraatbank-giris.com) bu güçlü bir phishing sinyalidir.
3. Deterministik araçların kaçırdığı ek riskler var mı?

Sadece JSON döndür, markdown kullanma:
{
  "urlRisk": <0-100>,
  "ibanRisk": <0-100>,
  "urgencyRisk": <0-100>,
  "brandSpoofRisk": <0-100>,
  "additionalRedFlags": ["tespit ettiğin ek kırmızı bayraklar, Türkçe"],
  "reasoning": "1-2 cümle Türkçe analiz özeti"
}`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { thinkingConfig: { thinkingBudget: 0 } },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini boş cevap döndürdü");

  const parsed = JSON.parse(cleanJson(text));

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

export async function validationAgent(data: ExtractionResult, isAudioTranscript = false) {
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

  // Domain spoof tespit edildiyse yüksek skoru kullan, yoksa genel brand+url heuristik
  const baseBrandRisk = domainSpoofRisk > 0
    ? domainSpoofRisk
    : hasBrand && hasUrl ? 60 : 0;

  const deterministicBrandSpoofRisk = Math.min(100, baseBrandRisk + impersonationRisk);

  const preliminary = {
    urlRisk,
    ibanRisk,
    urgencyRisk,
    brandSpoofRisk: deterministicBrandSpoofRisk,
  };

  // Step 2: Gemini reasoning — bağlamsal analiz ve domain doğrulama
  let finalRisks = { ...preliminary };
  let reasoning: string | undefined;
  const redFlags: string[] = [];

  try {
    const gemini = await geminiReasoning(data, preliminary, isAudioTranscript);

    // Gemini skoru ile deterministik skoru karşılaştır, yükseği al
    // Gemini bağlamsal olarak daha iyi değerlendirirse skoru yükseltebilir,
    // ama deterministik güvencelerin altına düşüremez
    finalRisks = {
      urlRisk: Math.max(urlRisk, gemini.urlRisk),
      ibanRisk: Math.max(ibanRisk, gemini.ibanRisk),
      urgencyRisk: Math.max(urgencyRisk, gemini.urgencyRisk),
      brandSpoofRisk: Math.max(deterministicBrandSpoofRisk, gemini.brandSpoofRisk),
    };

    reasoning = gemini.reasoning;

    redFlags.push(...gemini.additionalRedFlags);
  } catch (error) {
    console.error("Gemini validation reasoning başarısız, deterministik sonuç kullanılıyor:", error);
  }

  // Ses kaydı özel kontrolü: link/tıklama talebi vishing belirtisi
  if (isAudioTranscript) {
    const allText = [
      ...data.urgencyPhrases,
      data.textSummary,
    ].join(" ").toLowerCase();

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
      redFlags.push("Telefon görüşmesinde link tıklama talebi — sesli kimlik avı (vishing) belirtisi.");
    }
  }

  // Step 3: Deterministik red flag'ler
  if (finalRisks.urlRisk > 50) redFlags.push("Şüpheli veya resmi olmayan bağlantı tespit edildi.");
  if (finalRisks.ibanRisk > 50) redFlags.push("IBAN paylaşımı içeriyor — doğrudan ödeme talebi.");
  if (finalRisks.urgencyRisk > 40) redFlags.push("Aciliyet baskısı oluşturmaya yönelik ifadeler mevcut.");
  if (finalRisks.brandSpoofRisk > 40) redFlags.push("Bilinen bir marka veya kurum taklidi şüphesi.");

  // Tekrar edenleri temizle
  const uniqueRedFlags = [...new Set(redFlags)];

  return ValidationSchema.parse({
    ...finalRisks,
    redFlags: uniqueRedFlags,
    reasoning,
  });
}