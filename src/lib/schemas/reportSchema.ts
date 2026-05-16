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
});

export const ValidationSchema = z.object({
  urlRisk: z.number().min(0).max(100),
  ibanRisk: z.number().min(0).max(100),
  urgencyRisk: z.number().min(0).max(100),
  brandSpoofRisk: z.number().min(0).max(100),
  redFlags: z.array(z.string()),
  reasoning: z.string().optional(),
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