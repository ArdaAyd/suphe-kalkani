import { ai } from "@/lib/gemini/client";
import fs from "fs";

export type AudioAnalysisOutput = {
  transcript: string;
  language: string;
  riskObservations: string[];
};

export class AudioAnalysisAgent {
  name = "AudioAnalysisAgent";

  async analyze(
    filePath: string,
    mimeType = "audio/mpeg"
  ): Promise<AudioAnalysisOutput | null> {
    let audioData: string;

    try {
      audioData = await fs.promises.readFile(filePath, { encoding: "base64" });
    } catch (err) {
      console.error("AudioAnalysisAgent: dosya okunamadı:", err);
      return null;
    }

    const prompt = `Bu ses kaydını analiz et. Görevin dolandırıcılık tespiti için içerik analizi yapmaktır.

Yapman gerekenler:
1. Ses kaydındaki konuşmayı tam olarak transkripte et.
2. Konuşmanın dilini belirt.
3. Sesli dolandırıcılık (vishing) belirtilerini tespit et: sahte yetkili kimliği, IBAN/kart bilgisi talebi, aciliyet baskısı, tehdit, sahte ödül/kazanç.

Sadece JSON döndür, markdown kullanma:
{
  "transcript": "konuşmanın tam transkribi — yoksa boş string",
  "language": "tr veya en veya diğer",
  "riskObservations": ["tespit ettiğin şüpheli özellikler, Türkçe — yoksa boş liste"]
}`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: audioData,
                },
              },
            ],
          },
        ],
        config: { thinkingConfig: { thinkingBudget: 0 } },
      });

      const text = (response.text ?? "").replace(/```json/g, "").replace(/```/g, "").trim();

      const parsed = JSON.parse(text);

      return {
        transcript: typeof parsed.transcript === "string" ? parsed.transcript : "",
        language: typeof parsed.language === "string" ? parsed.language : "tr",
        riskObservations: Array.isArray(parsed.riskObservations)
          ? parsed.riskObservations.filter((r: unknown) => typeof r === "string")
          : [],
      };
    } catch (err) {
      console.error("AudioAnalysisAgent: Gemini hatası:", err);
      return null;
    }
  }
}
