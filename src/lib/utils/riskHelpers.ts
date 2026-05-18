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

export function extractHostname(url: string): string {
  try {
    const withProtocol = url.startsWith("http") ? url : `https://${url}`;
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return url.toLowerCase().split("/")[0];
  }
}

/**
 * Markdown link [metin](adres) biçimini ve fazlalık karakterleri temizleyip
 * düz bir URL string'ine indirger. Gemini bazen URL'leri markdown link olarak
 * üretir (extraction çıktısında ve araç çağrılarında); bu da domain sorgularını bozar.
 */
export function sanitizeUrl(raw: string): string {
  let u = (raw ?? "").trim();
  const md = u.match(/\[[^\]]*\]\(\s*([^)\s]+)\s*\)/);
  if (md) u = md[1];
  return u.replace(/[<>[\]]/g, "").replace(/[.,;)]+$/, "").trim();
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
    deepfakeRisk?: number;
  },
  isAudio = false
): number {
  const ecommerceRisk = scores.ecommerceRisk ?? 0;
  const deepfakeRisk = scores.deepfakeRisk ?? 0;
  let weightedScore: number;
  let bonus: number;

  if (isAudio) {
    // Vishing (sesli dolandırıcılık): URL görünmez, urgency + link talebi birincil sinyal
    weightedScore =
      scores.urlRisk * 0.18 +
      scores.ibanRisk * 0.22 +
      scores.urgencyRisk * 0.35 +
      scores.brandSpoofRisk * 0.15 +
      deepfakeRisk * 0.10;

    bonus =
      scores.urgencyRisk > 40 && scores.urlRisk > 0
        ? 25  // urgency + link talebi = klasik vishing combo
        : scores.urgencyRisk > 60
        ? 15  // yüksek urgency tek başına da önemli
        : scores.ibanRisk > 50
        ? 20  // IBAN diktate = ödeme dolandırıcılığı
        : 0;
  } else {
    // Metin / görsel / video: URL, brand spoof ve e-ticaret ağırlıklı
    weightedScore =
      scores.urlRisk * 0.18 +
      scores.ibanRisk * 0.22 +
      scores.urgencyRisk * 0.10 +
      scores.brandSpoofRisk * 0.22 +
      ecommerceRisk * 0.18 +
      deepfakeRisk * 0.10;

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

  // Deepfake özel bonusu (her iki durumda da)
  // Deepfake + brand impersonation = en tehlikeli kombinasyon
  if (deepfakeRisk >= 60 && scores.brandSpoofRisk >= 40) {
    bonus += 30;
  } else if (deepfakeRisk >= 80) {
    bonus += 20;  // tek başına bile güçlü deepfake sinyali
  } else if (deepfakeRisk >= 45) {
    bonus += 10;
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

export function detectEmails(text: string): string[] {
  // RFC 5322 simplified email regex
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  return text.match(emailRegex) ?? [];
}

function extractEmailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at === -1) return "";
  return email.slice(at + 1).toLowerCase().trim();
}

/**
 * Bir email domain'inin verilen "resmi" domain'le ilişkisini kontrol eder.
 *
 * Subdomain kabul edilir (email.trendyol.com → trendyol.com → eşleşir).
 *
 * Örnek:
 *   isEmailDomainOfficial("email.trendyol.com", ["trendyol.com"]) → true
 *   isEmailDomainOfficial("trendyol-mail.xyz", ["trendyol.com"])  → false
 */
function isEmailDomainOfficial(
  emailDomain: string,
  officialDomains: string[]
): boolean {
  return officialDomains.some(
    (official) =>
      emailDomain === official ||
      emailDomain.endsWith("." + official)
  );
}

/**
 * E-posta gönderici adresinin bilinen markaları taklit edip etmediğini kontrol eder.
 *
 * Mantık:
 *  1. Markanın adı email içinde geçiyor (ör: "trendyol" "trendyol-mail.xyz" içinde)
 *  2. AMA email domain'i markanın resmi domain'i veya subdomain'i DEĞİL
 *  → Phishing email tespiti, 90 risk
 *
 * Returns: 0 (temiz) veya 90 (spoof tespit edildi)
 */
export function checkEmailDomainSpoof(
  brandNames: string[],
  emails: string[]
): { risk: number; details: string[] } {
  if (emails.length === 0) return { risk: 0, details: [] };

  const details: string[] = [];
  let maxRisk = 0;

  for (const email of emails) {
    const emailDomain = extractEmailDomain(email);
    if (!emailDomain) continue;

    // 1. Bilinen marka karşılaştırması (sözlük tabanlı)
    for (const [key, officialDomains] of Object.entries(KNOWN_OFFICIAL_DOMAINS)) {
      const emailHasBrand = emailDomain.includes(key);
      const brandMentionedInText = brandNames.some((b) =>
        b.toLowerCase().replace(/[\s.]/g, "").includes(key)
      );

      if (emailHasBrand && brandMentionedInText) {
        const official = isEmailDomainOfficial(emailDomain, officialDomains);
        if (!official) {
          // Marka adı email domain'inde var ama resmi/subdomain değil → spoof
          maxRisk = Math.max(maxRisk, 90);
          details.push(
            `"${email}" adresi ${officialDomains[0]} resmi alanına ait DEĞİL — sahte e-posta`
          );
        }
      }
    }

    // 2. Şüpheli TLD email domain'inde (.xyz, .top, .click vb.)
    const suspiciousTlds = [
      ".xyz", ".top", ".click", ".tk", ".ml", ".ga", ".cf",
      ".gq", ".pw", ".icu", ".buzz", ".vip",
    ];
    if (suspiciousTlds.some((tld) => emailDomain.endsWith(tld))) {
      maxRisk = Math.max(maxRisk, 70);
      details.push(
        `"${email}" şüpheli alan adı uzantısı kullanıyor (${emailDomain.split(".").pop()})`
      );
    }

    // 3. Email domain'inde tire (-) + marka adı = phishing kalıbı
    if (
      emailDomain.includes("-") &&
      brandNames.some((b) =>
        emailDomain.includes(b.toLowerCase().replace(/[\s.]/g, ""))
      )
    ) {
      maxRisk = Math.max(maxRisk, 75);
      details.push(
        `"${email}" domain adında tire (-) içeriyor + marka adı geçiyor — phishing kalıbı`
      );
    }
  }

  return { risk: maxRisk, details: [...new Set(details)] };
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

// ─────────────────────────────────────────────
// Deepfake / AI-Generated İçerik Tespiti
// ─────────────────────────────────────────────

// Güçlü sinyaller — açık deepfake/AI iddiası
const STRONG_DEEPFAKE_PATTERNS = [
  "deepfake",
  "deep fake",
  "deep-fake",
  "ai-generated",
  "ai generated",
  "yapay zeka ile üretilmiş",
  "yapay zekayla üretilmiş",
  "synthetic video",
  "sentetik video",
  "face swap",
  "yüz değişimi",
];

// Orta sinyaller — manipülasyon belirtileri
const MEDIUM_DEEPFAKE_PATTERNS = [
  "yapay görünüm",
  "yapay yüz",
  "dudak senkronu",
  "lip-sync",
  "lip sync",
  "lipsync",
  "manipüle edilmiş",
  "yüz manipülasyonu",
  "yapay üretilmiş",
  "ai üretimi",
  "ses senkronizasyonu tutarsız",
  "yapay ses",
  "sentetik ses",
  "klonlanmış ses",
  "ses klonlama",
  "voice clone",
  "voice cloning",
];

// Belirsizlik ifadeleri (false positive azaltmak için)
const HEDGE_WORDS = [
  "olabilir",
  "olası",
  "şüphesi",
  "ihtimal",
  "may be",
  "could be",
  "olmayabilir",
  "olabileceğini",
  "muhtemel",
];

/**
 * Verilen gözlem/iddia listelerinden deepfake/AI sinyalleri tespit eder.
 *
 * Mantık:
 *  - "deepfake" / "AI-generated" gibi GÜÇLÜ ifade + hedge yok → 80 risk
 *  - "dudak senkronu" / "yapay görünüm" gibi orta + 2 sinyal → 70 risk
 *  - Tek orta sinyal → 45 risk
 *  - Sadece "olabilir/şüphesi" gibi tahmin → 25 risk
 */
export function detectDeepfakeSignals(observations: string[]): {
  risk: number;
  signals: string[];
} {
  const signals = new Set<string>();
  let strongCount = 0;
  let mediumCount = 0;
  let hedgedMediumCount = 0;

  for (const obs of observations) {
    if (!obs) continue;
    const lower = obs.toLowerCase();
    const isHedged = HEDGE_WORDS.some((h) => lower.includes(h));

    const hasStrong = STRONG_DEEPFAKE_PATTERNS.some((p) => lower.includes(p));
    const hasMedium = MEDIUM_DEEPFAKE_PATTERNS.some((p) => lower.includes(p));

    if (hasStrong) {
      signals.add(obs);
      if (isHedged) mediumCount++;
      else strongCount++;
    } else if (hasMedium) {
      signals.add(obs);
      if (isHedged) hedgedMediumCount++;
      else mediumCount++;
    }
  }

  let risk = 0;
  if (strongCount >= 2) risk = 95;
  else if (strongCount >= 1) risk = 80;
  else if (mediumCount >= 2) risk = 70;
  else if (mediumCount >= 1) risk = 45;
  else if (hedgedMediumCount >= 1) risk = 25;

  return { risk: clampScore(risk), signals: [...signals] };
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