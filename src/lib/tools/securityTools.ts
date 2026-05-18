/**
 * Güvenlik araçları — Gemini Function Calling için tanımlar ve implementasyonlar.
 *
 * 3 araç:
 *  1. check_domain_age   → RDAP (ücretsiz, API key gerekmez)
 *  2. check_iban_validity → ISO 7064 MOD 97-10 checksum
 *  3. check_url_safety   → Heuristik çok-faktörlü URL analizi
 */

import { Type, type FunctionDeclaration } from "@google/genai";
import { sanitizeUrl } from "@/lib/utils/riskHelpers";

// ─────────────────────────────────────────────
// 1. Domain Yaşı — RDAP
// ─────────────────────────────────────────────

export type DomainAgeResult = {
  domainAge: number | null;
  registrationDate: string | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  reason: string;
};

export async function checkDomainAge(domain: string): Promise<DomainAgeResult> {
  try {
    // Temiz domain adı çıkar (protokol, path, port'u kaldır)
    const clean = domain
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .split("?")[0]
      .split(":")[0]
      .toLowerCase()
      .trim();

    const rdapUrl = `https://rdap.org/domain/${clean}`;
    const resp = await fetch(rdapUrl, {
      signal: AbortSignal.timeout(4000),
      headers: { Accept: "application/json" },
    });

    if (!resp.ok) {
      return {
        domainAge: null,
        registrationDate: null,
        riskLevel: "UNKNOWN",
        reason: `RDAP yanıt vermedi (${resp.status}).`,
      };
    }

    const data = (await resp.json()) as {
      events?: Array<{ eventAction: string; eventDate: string }>;
    };

    const regEvent = data.events?.find(
      (e) => e.eventAction === "registration"
    );

    if (!regEvent) {
      return {
        domainAge: null,
        registrationDate: null,
        riskLevel: "UNKNOWN",
        reason: "Kayıt tarihi RDAP'ta bulunamadı.",
      };
    }

    const regDate = new Date(regEvent.eventDate);
    const ageInDays = Math.floor(
      (Date.now() - regDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    let riskLevel: "LOW" | "MEDIUM" | "HIGH";
    let reason: string;

    if (ageInDays < 30) {
      riskLevel = "HIGH";
      reason = `Domain yalnızca ${ageInDays} gün önce kaydedilmiş. Çok yeni domainler dolandırıcılık amacıyla oluşturulan tek kullanımlık siteler için tipiktir.`;
    } else if (ageInDays < 180) {
      riskLevel = "MEDIUM";
      reason = `Domain ${ageInDays} gün önce (yaklaşık ${Math.round(ageInDays / 30)} ay) kaydedilmiş — görece yeni.`;
    } else {
      riskLevel = "LOW";
      reason = `Domain ${ageInDays} gün önce (yaklaşık ${Math.round(ageInDays / 365)} yıl) kaydedilmiş — köklü bir alan adı.`;
    }

    return { domainAge: ageInDays, registrationDate: regEvent.eventDate, riskLevel, reason };
  } catch {
    return {
      domainAge: null,
      registrationDate: null,
      riskLevel: "UNKNOWN",
      reason: "Domain yaşı kontrolü başarısız (ağ hatası veya zaman aşımı).",
    };
  }
}

// ─────────────────────────────────────────────
// 2. IBAN Geçerliliği — ISO 7064 MOD 97-10
// ─────────────────────────────────────────────

export type IbanValidityResult = {
  valid: boolean;
  country: string;
  formattedIban: string;
  reason: string;
};

export function checkIbanValidity(iban: string): IbanValidityResult {
  const cleaned = iban.replace(/\s/g, "").toUpperCase();
  const country = cleaned.slice(0, 2);

  if (!/^[A-Z]{2}/.test(cleaned)) {
    return {
      valid: false,
      country: "UNKNOWN",
      formattedIban: cleaned,
      reason: "IBAN ülke kodu iki harf ile başlamalıdır.",
    };
  }

  // Türkiye IBAN uzunluğu 26 karakter
  if (country === "TR" && cleaned.length !== 26) {
    return {
      valid: false,
      country: "TR",
      formattedIban: cleaned,
      reason: `Türkiye IBAN'ı 26 karakter olmalı, bu ${cleaned.length} karakter.`,
    };
  }

  // IBAN sadece rakam ve büyük harf içermeli
  if (!/^[A-Z0-9]+$/.test(cleaned)) {
    return {
      valid: false,
      country,
      formattedIban: cleaned,
      reason: "IBAN geçersiz karakter içeriyor.",
    };
  }

  // MOD 97: ilk 4 karakteri sona taşı, harfleri sayıya çevir
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  const numeric = rearranged
    .split("")
    .map((c) => {
      const code = c.charCodeAt(0);
      // A=10, B=11, ..., Z=35
      return code >= 65 && code <= 90 ? (code - 55).toString() : c;
    })
    .join("");

  // Büyük sayıyı MOD 97 ile hesapla (chunk'lar halinde)
  let remainder = 0;
  for (const ch of numeric) {
    remainder = (remainder * 10 + parseInt(ch)) % 97;
  }

  const valid = remainder === 1;

  return {
    valid,
    country,
    formattedIban: cleaned,
    reason: valid
      ? "IBAN matematiksel doğrulamadan geçti (ISO 7064 MOD 97-10)."
      : "IBAN matematiksel doğrulamadan GEÇEMEDİ — uydurulmuş veya hatalı IBAN.",
  };
}

// ─────────────────────────────────────────────
// 3. URL Güvenlik Analizi — Heuristik
// ─────────────────────────────────────────────

export type UrlSafetyResult = {
  riskScore: number;
  riskFactors: string[];
  summary: string;
};

const SUSPICIOUS_TLDS = new Set([
  "xyz", "top", "cc", "tk", "ml", "ga", "cf", "gq",
  "pw", "icu", "click", "buzz", "vip", "live", "online",
  "site", "website", "space", "fun", "info", "biz",
]);

const URL_SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd",
  "cutt.ly", "rb.gy", "ow.ly", "buff.ly", "short.io",
]);

export function checkUrlSafety(url: string): UrlSafetyResult {
  const riskFactors: string[] = [];
  let riskScore = 0;

  try {
    const withProtocol = url.startsWith("http") ? url : `https://${url}`;
    const parsed = new URL(withProtocol);
    const hostname = parsed.hostname.toLowerCase();
    const domainParts = hostname.split(".");
    const tld = domainParts[domainParts.length - 1];

    // 1. Şüpheli TLD
    if (SUSPICIOUS_TLDS.has(tld)) {
      riskScore += 35;
      riskFactors.push(`Şüpheli üst düzey domain uzantısı (.${tld})`);
    }

    // 2. Derin alt domain yapısı
    if (domainParts.length > 3) {
      riskScore += 20;
      riskFactors.push(`Derin alt domain (${domainParts.length} seviye) — bankalar tek seviye kullanır`);
    }

    // 3. Domain adında tire
    const mainDomain = domainParts.slice(-2, -1)[0] ?? "";
    if (mainDomain.includes("-")) {
      riskScore += 25;
      riskFactors.push(`Domain adında tire (-) karakteri — phishing sitelerinde yaygın kalıp`);
    }

    // 4. IP adresi URL
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
      riskScore += 50;
      riskFactors.push("URL bir IP adresine yönlendiriyor — meşru bankalar domain kullanır");
    }

    // 5. URL kısaltma servisi
    if (URL_SHORTENERS.has(hostname)) {
      riskScore += 30;
      riskFactors.push("URL kısaltma servisi kullanılıyor — gerçek hedef adres gizleniyor");
    }

    // 6. HTTP (şifresiz bağlantı)
    if (parsed.protocol === "http:") {
      riskScore += 20;
      riskFactors.push("Şifresiz HTTP bağlantısı — güvenli bankacılık siteleri her zaman HTTPS kullanır");
    }

    // 7. Aşırı uzun URL
    if (url.length > 120) {
      riskScore += 15;
      riskFactors.push("Olağandışı uzun URL — gerçek hedefi gizlemek için kullanılıyor olabilir");
    }

    // 8. Sayısal subdomain (örn: 192-168-1.ziraatbank.xyz)
    if (domainParts.slice(0, -2).some((p) => /^\d+/.test(p))) {
      riskScore += 20;
      riskFactors.push("Sayısal alt domain — phishing tekniği");
    }
  } catch {
    riskScore += 40;
    riskFactors.push("URL ayrıştırılamadı — geçersiz format");
  }

  const clamped = Math.min(100, riskScore);

  const summary =
    clamped >= 70
      ? `Yüksek riskli URL: ${riskFactors.length} şüpheli özellik tespit edildi.`
      : clamped >= 35
      ? `Orta riskli URL: ${riskFactors.length} şüpheli özellik mevcut.`
      : riskFactors.length === 0
      ? "URL güvenli görünüyor."
      : `Düşük riskli URL: ${riskFactors.length} küçük uyarı.`;

  return { riskScore: clamped, riskFactors, summary };
}

// ─────────────────────────────────────────────
// Gemini Tool Declarations
// ─────────────────────────────────────────────

export const SECURITY_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "check_domain_age",
    description:
      "Bir alan adının (domain) RDAP kaydına bakarak kaç gün önce tescil edildiğini öğrenir. 30 günden az eski domainler dolandırıcılık için yüksek risk taşır. URL içinde domain varsa bu aracı mutlaka çağır.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        domain: {
          type: Type.STRING,
          description:
            "Kontrol edilecek domain (örn: 'ziraat-hesap.xyz', 'bank-verify.top'). Protokol olmadan yaz.",
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "check_iban_validity",
    description:
      "Bir IBAN numarasının matematiksel geçerliliğini ISO 7064 MOD 97-10 algoritmasıyla doğrular. Geçersiz IBAN uydurulmuş veya hatalı olabilir. İçerikte IBAN varsa bu aracı çağır.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        iban: {
          type: Type.STRING,
          description:
            "Doğrulanacak IBAN numarası (örn: 'TR33 0006 1005 1978 6457 8413 26')",
        },
      },
      required: ["iban"],
    },
  },
  {
    name: "check_url_safety",
    description:
      "Bir URL'in güvenlik göstergelerini analiz eder: şüpheli TLD (.xyz, .top vb.), derin alt domain, tire karakteri, IP adresi, URL kısaltma servisi, HTTP. URL varsa bu aracı çağır.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description:
            "Analiz edilecek tam URL (örn: 'http://ziraatbank-giris.xyz/hesap/dogrula')",
        },
      },
      required: ["url"],
    },
  },
];

// ─────────────────────────────────────────────
// Tool Executor
// ─────────────────────────────────────────────

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case "check_domain_age":
        return (await checkDomainAge(
          sanitizeUrl(String(args.domain ?? ""))
        )) as unknown as Record<string, unknown>;

      case "check_iban_validity":
        return checkIbanValidity(
          args.iban as string
        ) as unknown as Record<string, unknown>;

      case "check_url_safety":
        return checkUrlSafety(
          sanitizeUrl(String(args.url ?? ""))
        ) as unknown as Record<string, unknown>;

      default:
        return { error: `Bilinmeyen araç: ${name}` };
    }
  } catch (err) {
    return { error: `Araç çalıştırma hatası: ${String(err)}` };
  }
}
