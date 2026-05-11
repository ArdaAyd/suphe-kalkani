type ValidationResult = {
  urlRisk: number;
  ibanRisk: number;
  urgencyRisk: number;
  brandSpoofRisk: number;
  redFlags: string[];
};

export async function judgementAgent(
  validation: ValidationResult
) {
  console.log("Judgement Agent çalıştı");

  const totalRisk =
    validation.urlRisk +
    validation.ibanRisk +
    validation.urgencyRisk +
    validation.brandSpoofRisk;

  let riskLevel = "LOW";

  if (totalRisk > 150) {
    riskLevel = "HIGH";
  } else if (totalRisk > 50) {
    riskLevel = "MEDIUM";
  }

  return {
    finalScore: totalRisk,
    riskLevel,
    summary: "İçerik analiz edildi.",
    redFlags: validation.redFlags,
    recommendedActions: [
      "Linke tıklamayın",
      "Ödeme yapmadan önce doğrulama yapın",
    ],
    confidence: 85,
  };
}