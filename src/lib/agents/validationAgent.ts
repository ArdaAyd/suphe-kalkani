import {
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
  const hasBrand = data.brandNames.length > 0;
  const hasUrl = data.urls.length > 0;
  const hasUrgency = data.urgencyPhrases.length > 0;

const brandSpoofRisk =
  hasBrand && hasUrl ? 60 : 0;

const impersonationRisk =
  hasBrand && hasUrgency ? 40 : 0;

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

  if (impersonationRisk > 0) {
    redFlags.push("Marka adıyla aciliyet baskısı birlikte kullanılıyor.");
  }

  const result = {
    urlRisk,
    ibanRisk,
    urgencyRisk,
    brandSpoofRisk:
      brandSpoofRisk + impersonationRisk,
    redFlags,
  };

  return ValidationSchema.parse(result);
}