import {
  calculateBrandSpoofRisk,
  calculateIbanRisk,
  calculateUrgencyRisk,
  calculateUrlRisk,
} from "@/lib/utils/riskHelpers";

import {
  ValidationSchema,
  type ExtractionResult,
} from "@/lib/schemas/reportSchema";

export async function validationAgent(data: ExtractionResult) {
  console.log("Validation Agent çalıştı");

  const urlRisk = calculateUrlRisk(data.urls);
  const ibanRisk = calculateIbanRisk(data.ibans);
  const urgencyRisk = calculateUrgencyRisk(data.urgencyPhrases);
  const brandSpoofRisk = calculateBrandSpoofRisk(data.brandNames, data.urls);

  const redFlags: string[] = [];

  if (urlRisk > 50) {
    redFlags.push("Şüpheli bağlantı tespit edildi.");
  }

  if (ibanRisk > 50) {
    redFlags.push("IBAN paylaşımı tespit edildi.");
  }

  if (urgencyRisk > 40) {
    redFlags.push("Aciliyet dili kullanılıyor.");
  }

  if (brandSpoofRisk > 40) {
    redFlags.push("Marka taklidi şüphesi mevcut.");
  }

  const result = {
    urlRisk,
    ibanRisk,
    urgencyRisk,
    brandSpoofRisk,
    redFlags,
  };

  return ValidationSchema.parse(result);
}