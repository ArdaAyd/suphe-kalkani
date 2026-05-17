import { ai } from "@/lib/gemini/client";
import { calculateFinalScore, getRiskLevel } from "@/lib/utils/riskHelpers";
import {
  FinalReportSchema,
  type ExtractionResult,
  type ValidationResult,
} from "@/lib/schemas/reportSchema";

function cleanJson(text: string) {
  return text.replace(/```json/g, "").replace(/```/g, "").trim();
}

type GeminiJudgementOutput = {
  headline: string;
  summary: string;
  recommendedActions: string[];
};

async function geminiJudgement(
  extraction: ExtractionResult,
  validation: ValidationResult,
  finalScore: number,
  riskLevel: "LOW" | "MEDIUM" | "HIGH",
  isAudioTranscript = false
): Promise<GeminiJudgementOutput> {
  const sourceNote = isAudioTranscript
    ? "\n⚠️ Kaynak: Ses kaydı transkribi (sesli dolandırıcılık / vishing). Önerilen aksiyonlarda telefon görüşmesine özel uyarılar ver."
    : "";

  const prompt = `Sen bir siber güvenlik ve finansal dolandırıcılık uzmanısın. Aşağıdaki analiz sonuçlarına göre kullanıcıya Türkçe, kişiselleştirilmiş ve uygulanabilir bir rapor yaz.${sourceNote}

Risk Skoru: ${finalScore}/100
Risk Seviyesi: ${riskLevel}
Validation Agent Analizi: ${validation.reasoning ?? "—"}
${(validation.deepfakeRisk ?? 0) >= 45 ? `\n⚠️ AI/Deepfake Riski: ${validation.deepfakeRisk}/100 — Bu içerikte yapay zeka ile üretilmiş veya manipüle edilmiş görsel/ses sinyalleri tespit edildi. Raporda bu konuyu MUTLAKA vurgula (basit Türkçe ile: "video/ses sahte olabilir, yapay zeka ile üretilmiş olabilir").\n` : ""}

Extraction Agent Tespitleri:
- Marka/Kurum: ${extraction.brandNames.length > 0 ? extraction.brandNames.join(", ") : "tespit edilmedi"}
- URL'ler: ${extraction.urls.length > 0 ? extraction.urls.join(", ") : "tespit edilmedi"}
- Gönderici E-posta: ${extraction.senderEmails && extraction.senderEmails.length > 0 ? extraction.senderEmails.join(", ") : "tespit edilmedi"}
- IBAN'lar: ${extraction.ibans.length > 0 ? extraction.ibans.join(", ") : "tespit edilmedi"}
- Telefon: ${extraction.phones.length > 0 ? extraction.phones.join(", ") : "tespit edilmedi"}
- Aciliyet İfadeleri: ${extraction.urgencyPhrases.length > 0 ? extraction.urgencyPhrases.join("; ") : "tespit edilmedi"}
- Fiyat İddiaları: ${extraction.priceClaims && extraction.priceClaims.length > 0 ? extraction.priceClaims.join("; ") : "yok"}
- Çekiliş/Hediye Vaadleri: ${extraction.giveawayPhrases && extraction.giveawayPhrases.length > 0 ? extraction.giveawayPhrases.join("; ") : "yok"}
- Sahte Kampanya İddiaları: ${extraction.discountClaims && extraction.discountClaims.length > 0 ? extraction.discountClaims.join("; ") : "yok"}

Kırmızı Bayraklar: ${validation.redFlags.length > 0 ? validation.redFlags.join("; ") : "yok"}

HEDEF KİTLE: Yaşlı veya teknolojiden anlamayan kullanıcılar. Sıradan insanlar.

Kurallar:
- headline: TEK CÜMLE, en fazla 90 karakter. Çok basit Türkçe. Teknik terim YOK (phishing, vishing, oltalama vb. yazma). Verdict net olsun: ne olduğunu söyle.
  ${riskLevel === "HIGH" ? "Örnek: \"Bu mesaj büyük olasılıkla bir dolandırıcılık girişimi.\"" : riskLevel === "MEDIUM" ? "Örnek: \"Bu mesajda şüpheli işaretler var, dikkatli olun.\"" : "Örnek: \"Bu içerik şu an için güvenli görünüyor.\""}
- summary: 2-3 cümle. Spesifik detaylar (marka, URL, IBAN, ifade) içersin. Yine sade dil. ${riskLevel === "HIGH" ? "Güçlü ve net uyarı ver." : riskLevel === "MEDIUM" ? "Dikkatli ama panik yaratmayan bir ton kullan." : "Sakin ve bilgilendirici ol."}
- recommendedActions: En fazla 4 madde. EYLEM odaklı, emir kipinde. Kısa (10-20 kelime). Genel tavsiye değil, bu duruma özel. Türk kurumlarının resmi domain adlarını bil: ziraatbank.com.tr, garantibbva.com.tr, isbank.com.tr, e-devlet.gov.tr vb.

Sadece JSON döndür, markdown kullanma:
{
  "headline": "...",
  "summary": "...",
  "recommendedActions": ["...", "...", "..."]
}`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { thinkingConfig: { thinkingBudget: 0 } },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini boş cevap döndürdü");

  const parsed = JSON.parse(cleanJson(text));

  const headline = typeof parsed.headline === "string" && parsed.headline.trim()
    ? parsed.headline.trim()
    : null;

  const summary = typeof parsed.summary === "string" && parsed.summary.trim()
    ? parsed.summary.trim()
    : null;

  const actions = Array.isArray(parsed.recommendedActions)
    ? parsed.recommendedActions.filter((a: unknown) => typeof a === "string")
    : [];

  if (!headline || !summary || actions.length === 0) throw new Error("Gemini eksik veri döndürdü");

  return { headline, summary, recommendedActions: actions };
}

function fallbackHeadline(
  riskLevel: "LOW" | "MEDIUM" | "HIGH"
): string {
  if (riskLevel === "LOW") return "Bu içerik şu an için güvenli görünüyor.";
  if (riskLevel === "MEDIUM") return "Bu içerikte şüpheli işaretler var, dikkatli olun.";
  return "Bu içerik büyük olasılıkla bir dolandırıcılık girişimi.";
}

function fallbackSummary(
  riskLevel: "LOW" | "MEDIUM" | "HIGH",
  extraction: ExtractionResult,
  isAudioTranscript = false
): string {
  const audioNote = isAudioTranscript ? " Bu içerik bir telefon görüşmesinden alınmıştır." : "";
  if (riskLevel === "LOW") {
    return extraction.urls.length > 0
      ? `İçerik genel olarak güvenli görünüyor. Tespit edilen bağlantıları yine de dikkatli inceleyin.${audioNote}`
      : `İçerik güvenli görünüyor.${audioNote}`;
  }
  if (riskLevel === "MEDIUM") {
    const parts = ["İçerikte dikkat gerektiren riskler tespit edildi."];
    if (extraction.brandNames.length > 0) parts.push(`"${extraction.brandNames[0]}" adına gelen bu mesajı resmi kanallardan doğrulayın.`);
    return parts.join(" ");
  }
  const parts = ["Yüksek riskli dolandırıcılık girişimi belirtileri tespit edildi."];
  if (extraction.brandNames.length > 0 && extraction.urls.length > 0) {
    parts.push(`"${extraction.brandNames[0]}" kurumunu taklit eden sahte bir bağlantı içeriyor.`);
  }
  return parts.join(" ");
}

function fallbackActions(extraction: ExtractionResult, isAudioTranscript = false): string[] {
  const actions: string[] = [];
  if (extraction.ibans.length > 0) actions.push("Bu IBAN'a ödeme yapmadan önce kurumun resmi hattını arayarak doğrulayın.");
  if (extraction.urls.length > 0) actions.push("Bağlantılara tıklamayın; adresi tarayıcınıza elle yazın.");
  if (extraction.brandNames.length > 0) actions.push(`"${extraction.brandNames[0]}" markasının resmi müşteri hizmetleriyle iletişime geçin.`);
  if (isAudioTranscript) actions.push("Sizi arayan kişiyi resmi hat üzerinden geri arayarak kimliğini doğrulayın.");
  if (actions.length === 0) actions.push("İçeriği resmi kanallar üzerinden doğrulayın.", "Kişisel bilgi paylaşmayın.");
  return actions;
}

function calculateConfidence(extraction: ExtractionResult): number {
  let confidence = 65;
  if (extraction.urls.length > 0) confidence += 10;
  if (extraction.ibans.length > 0) confidence += 10;
  if (extraction.phones.length > 0) confidence += 5;
  if (extraction.brandNames.length > 0) confidence += 5;
  if (extraction.urgencyPhrases.length > 0) confidence += 5;
  if (extraction.textSummary.length > 50) confidence += 5;
  return Math.min(confidence, 95);
}

export async function judgementAgent(
  validation: ValidationResult,
  extraction: ExtractionResult,
  isAudioTranscript = false
) {
  console.log("Judgement Agent çalıştı");

  const finalScore = calculateFinalScore({
    urlRisk: validation.urlRisk,
    ibanRisk: validation.ibanRisk,
    urgencyRisk: validation.urgencyRisk,
    brandSpoofRisk: validation.brandSpoofRisk,
    ecommerceRisk: validation.ecommerceRisk,
    deepfakeRisk: validation.deepfakeRisk,
  }, isAudioTranscript);

  const riskLevel = getRiskLevel(finalScore);
  const confidence = calculateConfidence(extraction);

  let headline: string;
  let summary: string;
  let recommendedActions: string[];

  try {
    const gemini = await geminiJudgement(extraction, validation, finalScore, riskLevel, isAudioTranscript);
    headline = gemini.headline;
    summary = gemini.summary;
    recommendedActions = gemini.recommendedActions;
  } catch (error) {
    console.error("Gemini judgement başarısız, fallback kullanılıyor:", error);
    headline = fallbackHeadline(riskLevel);
    summary = fallbackSummary(riskLevel, extraction, isAudioTranscript);
    recommendedActions = fallbackActions(extraction, isAudioTranscript);
  }

  if (riskLevel === "HIGH") {
    recommendedActions = [
      ...recommendedActions,
      "Bu mesajı ilgili kuruma ve BTK'ya (şikayetim.gov.tr) bildirin.",
    ].slice(0, 4);
  }

  return FinalReportSchema.parse({
    finalScore,
    riskLevel,
    headline,
    summary,
    redFlags: validation.redFlags,
    recommendedActions,
    confidence,
  });
}