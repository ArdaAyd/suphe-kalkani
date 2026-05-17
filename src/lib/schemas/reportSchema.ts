import { z } from "zod";

export const RiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const ExtractionSchema = z.object({
  textSummary: z.string(),
  urls: z.array(z.string()),
  ibans: z.array(z.string()),
  phones: z.array(z.string()),
  brandNames: z.array(z.string()),
  claims: z.array(z.string()),
  urgencyPhrases: z.array(z.string()),
  // E-ticaret odaklı yeni alanlar (opsiyonel, geriye uyumlu)
  priceClaims: z.array(z.string()).optional().default([]),
  giveawayPhrases: z.array(z.string()).optional().default([]),
  discountClaims: z.array(z.string()).optional().default([]),
  // E-posta gönderici adresleri (özellikle email screenshot'larında kritik)
  senderEmails: z.array(z.string()).optional().default([]),
});

export const ValidationSchema = z.object({
  urlRisk: z.number().min(0).max(100),
  ibanRisk: z.number().min(0).max(100),
  urgencyRisk: z.number().min(0).max(100),
  brandSpoofRisk: z.number().min(0).max(100),
  ecommerceRisk: z.number().min(0).max(100).optional().default(0),
  deepfakeRisk: z.number().min(0).max(100).optional().default(0),
  deepfakeSignals: z.array(z.string()).optional().default([]),
  redFlags: z.array(z.string()),
  reasoning: z.string().optional(),
  // Gemini'nin canlı yaptığı Google aramaları (grounding metadata)
  webSearchQueries: z.array(z.string()).optional(),
  toolCalls: z.array(z.string()).optional(),
});

export const FinalReportSchema = z.object({
  finalScore: z.number().min(0).max(100),
  riskLevel: RiskLevelSchema,
  headline: z.string(),
  summary: z.string(),
  redFlags: z.array(z.string()),
  recommendedActions: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});

export type ExtractionResult = z.infer<typeof ExtractionSchema>;
export type ValidationResult = z.infer<typeof ValidationSchema>;
export type FinalReport = z.infer<typeof FinalReportSchema>;