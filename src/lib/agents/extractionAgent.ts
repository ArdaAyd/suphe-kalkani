import { ExtractionSchema } from "@/lib/schemas/reportSchema";
import {
  detectIbans,
  detectPhones,
  detectUrgencyPhrases,
  detectUrls,
} from "@/lib/utils/riskHelpers";

export async function extractionAgent(input: string) {
  console.log("Extraction Agent çalıştı");

  const result = {
    textSummary: input,
    urls: detectUrls(input),
    ibans: detectIbans(input),
    phones: detectPhones(input),
    brandNames: [],
    claims: [input],
    urgencyPhrases: detectUrgencyPhrases(input),
  };

  return ExtractionSchema.parse(result);
}