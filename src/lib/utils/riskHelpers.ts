// import type { RiskLevel } from "@/lib/types/risk";

export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function calculateFinalScore(scores: {
  urlRisk: number;
  ibanRisk: number;
  urgencyRisk: number;
  brandSpoofRisk: number;
}): number {
  const weightedScore =
    scores.urlRisk * 0.4 +
    scores.ibanRisk * 0.3 +
    scores.urgencyRisk * 0.2 +
    scores.brandSpoofRisk * 0.1;

  const bonus =
    scores.urlRisk > 70 && scores.brandSpoofRisk > 50
        ? 20
        : scores.urlRisk > 70 && scores.ibanRisk > 70
        ? 15
        : 0;

  return clampScore(weightedScore + bonus);
}

export function getRiskLevel(score: number): "LOW" | "MEDIUM" | "HIGH" {
  if (score >= 70) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

export function detectUrgencyPhrases(text: string): string[] {
  const phrases = [
    "hemen",
    "acil",
    "son şans",
    "sınırlı süre",
    "bugün içinde",
    "hesabınız kapanacak",
    "ödeme yapın",
    "tıklayın",
    "kaçırmayın",
  ];

  const lowerText = text.toLowerCase();

  return phrases.filter((phrase) => lowerText.includes(phrase));
}

export function detectUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  return text.match(urlRegex) ?? [];
}

export function detectIbans(text: string): string[] {
  const ibanRegex = /TR\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2}/gi;
  return text.match(ibanRegex) ?? [];
}

export function detectPhones(text: string): string[] {
  const phoneRegex = /(\+90|0)?\s?5\d{2}\s?\d{3}\s?\d{2}\s?\d{2}/g;
  return text.match(phoneRegex) ?? [];
}

export function isShortUrl(url: string): boolean {
  const shorteners = ["bit.ly", "tinyurl", "t.co", "goo.gl", "is.gd", "cutt.ly"];
  return shorteners.some((domain) => url.toLowerCase().includes(domain));
}

export function calculateUrlRisk(urls: string[]): number {
  if (urls.length === 0) return 0;

  let risk = 30;

  if (urls.some(isShortUrl)) {
    risk += 40;
  }

  if (urls.some((url) => !url.startsWith("https://"))) {
    risk += 20;
  }

  return clampScore(risk);
}

export function calculateIbanRisk(ibans: string[]): number {
  if (ibans.length === 0) return 0;
  return 75;
}

export function calculateUrgencyRisk(urgencyPhrases: string[]): number {
  if (urgencyPhrases.length === 0) return 0;
  return clampScore(urgencyPhrases.length * 20);
}

export function calculateBrandSpoofRisk(brandNames: string[], urls: string[]): number {
  if (brandNames.length === 0 || urls.length === 0) return 0;

  const joinedUrls = urls.join(" ").toLowerCase();

  const suspicious = brandNames.some((brand) => {
    const normalizedBrand = brand.toLowerCase().replace(/\s/g, "");
    return !joinedUrls.includes(normalizedBrand);
  });

  return suspicious ? 60 : 0;
}