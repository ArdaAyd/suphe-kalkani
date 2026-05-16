// Bilinen Türk kurum ve markaların resmi domain listesi
const KNOWN_OFFICIAL_DOMAINS: Record<string, string[]> = {
  // Bankalar
  ziraatbank: ["ziraatbank.com.tr"],
  garanti: ["garantibbva.com.tr"],
  garantibbva: ["garantibbva.com.tr"],
  isbank: ["isbank.com.tr"],
  akbank: ["akbank.com"],
  yapikredi: ["yapikredi.com.tr"],
  halkbank: ["halkbank.com.tr"],
  vakifbank: ["vakifbank.com.tr"],
  denizbank: ["denizbank.com"],
  finansbank: ["qnbfinansbank.com"],
  qnb: ["qnbfinansbank.com"],
  enpara: ["enpara.com"],
  // Kargo
  ptt: ["ptt.gov.tr"],
  aras: ["arasshipping.com", "araskargo.com.tr"],
  yurtici: ["yurticikargo.com"],
  mng: ["mngkargo.com.tr"],
  ups: ["ups.com"],
  dhl: ["dhl.com"],
  // E-ticaret
  trendyol: ["trendyol.com"],
  hepsiburada: ["hepsiburada.com"],
  n11: ["n11.com"],
  amazon: ["amazon.com.tr", "amazon.com"],
  // Telekom
  turkcell: ["turkcell.com.tr"],
  vodafone: ["vodafone.com.tr"],
  turktelekom: ["turktelekom.com.tr"],
  // Devlet
  edevlet: ["turkiye.gov.tr", "e-devlet.gov.tr"],
  sgk: ["sgk.gov.tr"],
  gib: ["gib.gov.tr"],
};

function extractHostname(url: string): string {
  try {
    const withProtocol = url.startsWith("http") ? url : `https://${url}`;
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return url.toLowerCase().split("/")[0];
  }
}

export function checkDomainSpoof(brandNames: string[], urls: string[]): number {
  if (brandNames.length === 0 || urls.length === 0) return 0;

  let maxRisk = 0;

  for (const url of urls) {
    const hostname = extractHostname(url);

    for (const brandName of brandNames) {
      const brand = brandName.toLowerCase().replace(/[\s.]/g, "");

      // Bilinen kurum kontrolü: brand keyword'ü hem brand adıyla hem URL'yle eşleşiyor mu?
      for (const [key, officialDomains] of Object.entries(KNOWN_OFFICIAL_DOMAINS)) {
        const isBrandRelated = brand.includes(key) || key.includes(brand);
        const isBrandInUrl = hostname.includes(key);

        if (isBrandRelated && isBrandInUrl) {
          const isOfficialDomain = officialDomains.some(
            (od) => hostname === od || hostname.endsWith("." + od)
          );
          if (!isOfficialDomain) {
            // Bilinen kurumun adı URL'de var ama resmi domain değil → typosquatting
            maxRisk = Math.max(maxRisk, 90);
          }
        }
      }

      // Genel kontrol: brand keyword URL'de var + şüpheli domain pattern
      if (brand.length >= 4 && hostname.includes(brand)) {
        const isOfficialTld =
          hostname.endsWith(".com.tr") ||
          hostname.endsWith(".gov.tr") ||
          hostname.endsWith(".org.tr") ||
          hostname.endsWith(".edu.tr");

        const hasSuspiciousPattern =
          hostname.includes("-") || hostname.split(".").length > 3;

        if (!isOfficialTld && hasSuspiciousPattern) {
          maxRisk = Math.max(maxRisk, 75);
        }
      }
    }
  }

  return maxRisk;
}

export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function calculateFinalScore(
  scores: {
    urlRisk: number;
    ibanRisk: number;
    urgencyRisk: number;
    brandSpoofRisk: number;
  },
  isAudio = false
): number {
  let weightedScore: number;
  let bonus: number;

  if (isAudio) {
    // Vishing (sesli dolandırıcılık): URL görünmez, urgency + link talebi birincil sinyal
    weightedScore =
      scores.urlRisk * 0.20 +
      scores.ibanRisk * 0.25 +
      scores.urgencyRisk * 0.40 +
      scores.brandSpoofRisk * 0.15;

    bonus =
      scores.urgencyRisk > 40 && scores.urlRisk > 0
        ? 25  // urgency + link talebi = klasik vishing combo
        : scores.urgencyRisk > 60
        ? 15  // yüksek urgency tek başına da önemli
        : scores.ibanRisk > 50
        ? 20  // IBAN diktate = ödeme dolandırıcılığı
        : 0;
  } else {
    // Metin / görsel: URL ve brand spoof ağırlıklı
    weightedScore =
      scores.urlRisk * 0.25 +
      scores.ibanRisk * 0.30 +
      scores.urgencyRisk * 0.15 +
      scores.brandSpoofRisk * 0.30;

    bonus =
      scores.brandSpoofRisk >= 80 && scores.urlRisk > 0
        ? 25  // brand impersonation + URL = phishing
        : scores.ibanRisk > 50 && scores.urgencyRisk > 30
        ? 20  // IBAN + urgency = ödeme baskısı
        : scores.urlRisk > 70 && scores.brandSpoofRisk > 50
        ? 20
        : scores.urlRisk > 70 && scores.ibanRisk > 70
        ? 15
        : 0;
  }

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