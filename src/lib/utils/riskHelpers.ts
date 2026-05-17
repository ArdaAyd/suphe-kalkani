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
  // E-ticaret (genişletilmiş)
  trendyol: ["trendyol.com"],
  hepsiburada: ["hepsiburada.com"],
  n11: ["n11.com"],
  amazon: ["amazon.com.tr", "amazon.com"],
  gittigidiyor: ["gittigidiyor.com"],
  ciceksepeti: ["ciceksepeti.com"],
  hopi: ["hopi.com.tr"],
  modanisa: ["modanisa.com"],
  lcwaikiki: ["lcwaikiki.com"],
  defacto: ["defacto.com.tr"],
  boyner: ["boyner.com.tr"],
  morhipo: ["morhipo.com"],
  // Yemek & market
  yemeksepeti: ["yemeksepeti.com"],
  getir: ["getir.com"],
  migros: ["migros.com.tr", "sanalmarket.com.tr"],
  carrefoursa: ["carrefoursa.com"],
  bim: ["bim.com.tr"],
  a101: ["a101.com.tr"],
  sok: ["sokmarket.com.tr"],
  // Teknoloji & beyaz eşya
  teknosa: ["teknosa.com"],
  mediamarkt: ["mediamarkt.com.tr"],
  vatan: ["vatanbilgisayar.com"],
  arcelik: ["arcelik.com.tr"],
  beko: ["beko.com.tr"],
  // Spor & yaşam
  decathlon: ["decathlon.com.tr"],
  ikea: ["ikea.com.tr"],
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
    ecommerceRisk?: number;
  },
  isAudio = false
): number {
  const ecommerceRisk = scores.ecommerceRisk ?? 0;
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
    // Metin / görsel: URL, brand spoof ve e-ticaret ağırlıklı
    weightedScore =
      scores.urlRisk * 0.20 +
      scores.ibanRisk * 0.25 +
      scores.urgencyRisk * 0.10 +
      scores.brandSpoofRisk * 0.25 +
      ecommerceRisk * 0.20;

    bonus =
      ecommerceRisk >= 70 && scores.urlRisk > 30
        ? 30  // fiyat anomalisi + şüpheli URL = e-ticaret dolandırıcılığı
        : scores.brandSpoofRisk >= 80 && scores.urlRisk > 0
        ? 25  // brand impersonation + URL = phishing
        : scores.ibanRisk > 50 && scores.urgencyRisk > 30
        ? 20  // IBAN + urgency = ödeme baskısı
        : scores.urlRisk > 70 && scores.brandSpoofRisk > 50
        ? 20
        : ecommerceRisk >= 60 && scores.urgencyRisk > 30
        ? 20  // çekiliş/sahte kampanya + urgency
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

// ─────────────────────────────────────────────
// E-ticaret dolandırıcılık detektörleri
// ─────────────────────────────────────────────

// Piyasa değeri (TL) — eşik altı fiyat tespit etmek için
const PRODUCT_MARKET_PRICES: Array<{ patterns: string[]; minRealistic: number }> = [
  { patterns: ["iphone 17 pro max", "iphone17 pro max"], minRealistic: 80000 },
  { patterns: ["iphone 17 pro"], minRealistic: 65000 },
  { patterns: ["iphone 17"], minRealistic: 50000 },
  { patterns: ["iphone 16 pro max"], minRealistic: 70000 },
  { patterns: ["iphone 16 pro"], minRealistic: 55000 },
  { patterns: ["iphone 16"], minRealistic: 45000 },
  { patterns: ["iphone 15 pro max"], minRealistic: 55000 },
  { patterns: ["iphone 15 pro"], minRealistic: 45000 },
  { patterns: ["iphone 15"], minRealistic: 35000 },
  { patterns: ["iphone 14"], minRealistic: 30000 },
  { patterns: ["iphone 13"], minRealistic: 25000 },
  { patterns: ["macbook pro"], minRealistic: 60000 },
  { patterns: ["macbook air"], minRealistic: 35000 },
  { patterns: ["macbook"], minRealistic: 30000 },
  { patterns: ["ipad pro"], minRealistic: 30000 },
  { patterns: ["ipad air"], minRealistic: 20000 },
  { patterns: ["ipad"], minRealistic: 12000 },
  { patterns: ["playstation 5", "ps5", "ps 5"], minRealistic: 25000 },
  { patterns: ["playstation 4", "ps4"], minRealistic: 12000 },
  { patterns: ["xbox series x"], minRealistic: 22000 },
  { patterns: ["xbox series s"], minRealistic: 12000 },
  { patterns: ["samsung galaxy s25 ultra", "s25 ultra"], minRealistic: 55000 },
  { patterns: ["samsung galaxy s25"], minRealistic: 40000 },
  { patterns: ["samsung galaxy s24 ultra", "s24 ultra"], minRealistic: 45000 },
  { patterns: ["samsung galaxy s24"], minRealistic: 30000 },
  { patterns: ["airpods pro"], minRealistic: 6500 },
  { patterns: ["airpods max"], minRealistic: 15000 },
  { patterns: ["airpods"], minRealistic: 4500 },
  { patterns: ["apple watch ultra"], minRealistic: 25000 },
  { patterns: ["apple watch"], minRealistic: 12000 },
  { patterns: ["dyson"], minRealistic: 8000 },
];

// Metinden fiyat tespit eden regex: "999 TL", "1.500 TL", "2,500 ₺", "499TL"
const PRICE_REGEX =
  /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d+)\s?(?:tl|₺|try|lira)\b/gi;

function parsePriceToNumber(raw: string): number {
  // "1.500", "2,500", "499" → 1500 / 2500 / 499
  // Türkçe yazımda nokta = binlik ayırıcı
  const cleaned = raw.replace(/[.,]/g, "");
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Fiyat anomalisi tespit eder. Bilinen ürün + gerçekçi olmayan düşük fiyat eşleşmesi.
 *
 * Örnek: "iPhone 15 Pro 999 TL" → anomaly tespit edilir (gerçek fiyat ~45.000 TL)
 */
export function detectPricingAnomalies(text: string): string[] {
  if (!text) return [];

  const lower = text.toLowerCase();
  const anomalies: string[] = [];

  // Tüm fiyatları çıkar
  const priceMatches = Array.from(lower.matchAll(PRICE_REGEX));
  if (priceMatches.length === 0) return [];

  // Her bilinen ürün için, metin içinde geçiyor mu kontrol et
  for (const product of PRODUCT_MARKET_PRICES) {
    const matchingPattern = product.patterns.find((p) => lower.includes(p));
    if (!matchingPattern) continue;

    // Bu ürün metinde var; fiyatlardan en düşüğünü al ve karşılaştır
    const prices = priceMatches.map((m) => parsePriceToNumber(m[1]));
    const lowestPrice = Math.min(...prices);

    if (lowestPrice > 0 && lowestPrice < product.minRealistic * 0.4) {
      // Gerçekçi fiyatın %40'ından daha düşükse anomali
      anomalies.push(
        `"${matchingPattern}" için ${lowestPrice.toLocaleString("tr-TR")} TL — piyasa değeri ~${product.minRealistic.toLocaleString("tr-TR")} TL (imkansız fiyat)`
      );
    }
  }

  return anomalies;
}

/**
 * Çekiliş/hediye/ödül tuzağı kalıplarını tespit eder.
 *
 * Örnek: "Tebrikler! iPhone kazandınız!" → "iPhone kazandınız"
 */
export function detectGiveawayPhrases(text: string): string[] {
  if (!text) return [];

  const lower = text.toLowerCase();
  const giveawayPatterns = [
    "tebrikler",
    "kazandınız",
    "kazandiniz",
    "ödül",
    "ödülünüz",
    "odul",
    "hediye kazan",
    "çekiliş",
    "cekilis",
    "kazandığınız",
    "size özel",
    "şanslı kullanıcı",
    "sansli kullanici",
    "bedava",
    "ücretsiz hediye",
    "ucretsiz hediye",
    "free iphone",
    "free gift",
    "you won",
    "congratulations",
  ];

  return giveawayPatterns.filter((p) => lower.includes(p));
}

/**
 * Sahte indirim/kampanya ifadelerini tespit eder.
 *
 * Örnek: "%95 indirim", "Son 2 saat", "Stoklar tükeniyor"
 */
export function detectFakeDiscountPhrases(text: string): string[] {
  if (!text) return [];

  const lower = text.toLowerCase();
  const flags: string[] = [];

  // İmkansız indirim oranları (%70 üzeri büyük markada gerçekçi değil)
  const discountMatch = lower.match(/%\s?(\d{2,3})\s?(indirim|off|discount)?/g);
  if (discountMatch) {
    for (const m of discountMatch) {
      const pct = parseInt(m.replace(/[^\d]/g, ""), 10);
      if (pct >= 70 && pct <= 100) {
        flags.push(`%${pct} indirim iddiası (gerçekçi değil)`);
      }
    }
  }

  // Sahte kampanya kalıpları
  const fakeCampaignPatterns: Array<[string, string]> = [
    ["son 2 saat", "yapay süre baskısı"],
    ["son 1 saat", "yapay süre baskısı"],
    ["stoklar tükeniyor", "yapay stok baskısı"],
    ["son ürün", "yapay stok baskısı"],
    ["tükenmek üzere", "yapay stok baskısı"],
    ["sadece bugün", "yapay süre baskısı"],
    ["son gün", "yapay süre baskısı"],
    ["black friday özel", "kampanya iddiası — doğrulanmalı"],
    ["kara cuma", "kampanya iddiası — doğrulanmalı"],
    ["mega indirim", "kampanya iddiası — doğrulanmalı"],
    ["fırsat kaçmaz", "yapay aciliyet"],
    ["kaçırmayın", "yapay aciliyet"],
  ];

  for (const [pattern, flag] of fakeCampaignPatterns) {
    if (lower.includes(pattern)) flags.push(flag);
  }

  return [...new Set(flags)];
}

/**
 * E-ticaret risk skorunu hesaplar (0-100).
 *
 * - Fiyat anomalisi (en güçlü sinyal) → 70
 * - Çekiliş + URL kombinasyonu → 60
 * - Sahte indirim + URL kombinasyonu → 45
 * - Çoklu sinyal birikir, max 100
 */
export function calculateEcommerceRisk(
  pricingAnomalies: string[],
  giveawayPhrases: string[],
  fakeDiscountPhrases: string[],
  hasUrl: boolean
): number {
  let risk = 0;

  if (pricingAnomalies.length > 0) risk += 70;
  if (giveawayPhrases.length > 0 && hasUrl) risk += 60;
  else if (giveawayPhrases.length > 0) risk += 30;
  if (fakeDiscountPhrases.length >= 2 && hasUrl) risk += 45;
  else if (fakeDiscountPhrases.length > 0) risk += 20;

  return clampScore(risk);
}