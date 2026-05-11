import { ai } from "@/lib/gemini/client";
import { ExtractionSchema } from "@/lib/schemas/reportSchema";
import {
  detectIbans,
  detectPhones,
  detectUrgencyPhrases,
  detectUrls,
} from "@/lib/utils/riskHelpers";

type ExtractionAgentInput = {
  text: string;
  imageBase64?: string;
  imageMimeType?: string;
};

function cleanGeminiJson(text: string) {
  return text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
}

function fallbackExtraction(input: string) {
  return {
    textSummary: input,
    urls: detectUrls(input),
    ibans: detectIbans(input),
    phones: detectPhones(input),
    brandNames: [],
    claims: [input],
    urgencyPhrases: detectUrgencyPhrases(input),
  };
}

export async function extractionAgent(input: ExtractionAgentInput) {
  console.log("Extraction Agent çalıştı");

  try {
    const contents: Array<
      | string
      | {
          inlineData: {
            mimeType: string;
            data: string;
          };
        }
    > = [];

    contents.push(`
Aşağıdaki şüpheli içeriği analiz et.

Sadece geçerli JSON döndür.
Markdown kullanma.

JSON formatı:
{
  "textSummary": "kısa özet",
  "urls": [],
  "ibans": [],
  "phones": [],
  "brandNames": [],
  "claims": [],
  "urgencyPhrases": []
}

Kullanıcı metni:
${input.text}
`);

    if (input.imageBase64 && input.imageMimeType) {
      contents.push({
        inlineData: {
          mimeType: input.imageMimeType,
          data: input.imageBase64,
        },
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
    });

    const text = response.text;

    if (!text) {
      throw new Error("Gemini boş cevap döndürdü.");
    }

    const cleanedText = cleanGeminiJson(text);
    const parsed = JSON.parse(cleanedText);

    return ExtractionSchema.parse(parsed);
  } catch (error) {
    console.error(
      "Gemini extraction failed, fallback çalıştı:",
      error
    );

    const fallback = fallbackExtraction(input.text);

    return ExtractionSchema.parse(fallback);
  }
}