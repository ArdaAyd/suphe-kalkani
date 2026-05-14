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
  audioPath?: string;
  audioMimeType?: string;
  isAudioTranscript?: boolean; // ses transkriptinden geldiğini belirtir
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
    const prompt = `Aşağıdaki şüpheli içeriği analiz et.

Sadece geçerli JSON döndür.
Markdown kullanma.

JSON formatı:
{
  "textSummary": "kısa özet (1-2 cümle)",
  "urls": ["tespit edilen URL'ler"],
  "ibans": ["tespit edilen IBAN'lar"],
  "phones": ["tespit edilen telefon numaraları"],
  "brandNames": ["tespit edilen marka veya kurum adları"],
  "claims": ["öne sürülen iddialar veya teklifler"],
  "urgencyPhrases": ["aciliyet yaratan ifadeler"]
}

${input.text ? (input.isAudioTranscript ? `Ses kaydı transkribi — sesli dolandırıcılık kalıplarına dikkat et (baskı, sahte yetkili, acele karar):\n${input.text}` : `Kullanıcı metni:\n${input.text}`) : "Görsel üzerinden analiz yap."}`;

    type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

    const parts: Part[] = [{ text: prompt }];

    if (input.imageBase64 && input.imageMimeType) {
      parts.push({
        inlineData: {
          mimeType: input.imageMimeType,
          data: input.imageBase64,
        },
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts }],
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