import {
  calculateFinalScore,
  getRiskLevel,
} from "@/lib/utils/riskHelpers";

import {
  FinalReportSchema,
  type ValidationResult,
} from "@/lib/schemas/reportSchema";

export async function judgementAgent(
  validation: ValidationResult
) {
  console.log("Judgement Agent çalıştı");

  const finalScore = calculateFinalScore({
    urlRisk: validation.urlRisk,
    ibanRisk: validation.ibanRisk,
    urgencyRisk: validation.urgencyRisk,
    brandSpoofRisk: validation.brandSpoofRisk,
  });

  const riskLevel = getRiskLevel(finalScore);

  let summary = "İçerik güvenli görünüyor.";

  if (riskLevel === "MEDIUM") {
    summary =
      "İçerikte dikkat edilmesi gereken bazı riskler bulundu.";
  }

  if (riskLevel === "HIGH") {
    summary =
      "Yüksek riskli dolandırıcılık belirtileri tespit edildi.";
  }

  const result = {
    finalScore,
    riskLevel,
    summary,
    redFlags: validation.redFlags,
    recommendedActions: [
      "Bağlantılara dikkat edin.",
      "Kişisel bilgi paylaşmayın.",
      "Ödeme öncesi resmi doğrulama yapın.",
    ],
    confidence: 88,
  };

  return FinalReportSchema.parse(result);
}