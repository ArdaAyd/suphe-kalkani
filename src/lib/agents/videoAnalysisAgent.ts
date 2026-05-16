import { ai } from "@/lib/gemini/client";
import fs from "fs";

export type VideoAnalysisOutput = {
  transcript: string;
  language: string;
  riskObservations: string[];    // Ses kaynaklı (vishing, baskı tonu, sahte yetkili)
  visualObservations: string[];  // Görsel kaynaklı (deepfake, sahte logo, sahte UI)
  sourceType: "video";
};

const MAX_INLINE_BYTES = 15 * 1024 * 1024; // 15 MB — base64 sonrası ~20 MB Gemini limitinin altında

export class VideoAnalysisAgent {
  name = "VideoAnalysisAgent";

  async analyze(
    videoPath: string,
    mimeType = "video/mp4"
  ): Promise<VideoAnalysisOutput | null> {
    // Dosya boyutu kontrolü
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(videoPath);
    } catch (err) {
      console.error("VideoAnalysisAgent: dosya okunamadı:", err);
      return null;
    }

    if (stat.size > MAX_INLINE_BYTES) {
      console.warn(
        `VideoAnalysisAgent: dosya çok büyük (${(stat.size / 1024 / 1024).toFixed(1)} MB > 15 MB), analiz atlanıyor`
      );
      return null;
    }

    let videoData: string;
    try {
      videoData = await fs.promises.readFile(videoPath, { encoding: "base64" });
    } catch (err) {
      console.error("VideoAnalysisAgent: dosya okunamadı:", err);
      return null;
    }

    const prompt = `Bu videoyu dolandırıcılık tespiti amacıyla hem SES hem GÖRSEL açısından analiz et.

Yapman gerekenler:
1. Videodaki konuşmayı tam olarak transkripte et.
2. Konuşmanın dilini belirt.
3. Sesli dolandırıcılık (vishing) belirtilerini tespit et:
   - Sahte yetkili kimliği (banka, devlet kurumu, kargo, müşteri hizmetleri gibi davranma)
   - IBAN / kart numarası / şifre / kişisel bilgi talebi
   - Aciliyet ve panik baskısı ("hemen", "bugün", "hesabınız kapanacak")
   - Sahte ödül veya kazanç vaadi
   - Link tıklama veya uygulama indirme talebi
4. Görsel dolandırıcılık belirtilerini tespit et:
   - Deepfake / yüz manipülasyonu (dudak senkronu tutarsızlığı, yapay görünüm)
   - Sahte veya manipüle edilmiş logo ve marka görselleri
   - Sahte uygulama veya web sitesi ekran görüntüsü
   - Sahte banka uygulaması, SMS veya bildirim gösterimi
   - Ünlü/yetkili kişi taklidi (ses veya görüntü)

Sadece JSON döndür, markdown kullanma:
{
  "transcript": "konuşmanın tam transkribi — yoksa boş string",
  "language": "tr veya en veya diğer",
  "riskObservations": ["sesli dolandırıcılık belirtileri, Türkçe — yoksa boş liste"],
  "visualObservations": ["görsel dolandırıcılık belirtileri, Türkçe — yoksa boş liste"]
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
                  data: videoData,
                },
              },
            ],
          },
        ],
        config: { thinkingConfig: { thinkingBudget: 0 } },
      });

      const text = (response.text ?? "")
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      const parsed = JSON.parse(text);

      return {
        transcript:
          typeof parsed.transcript === "string" ? parsed.transcript : "",
        language:
          typeof parsed.language === "string" ? parsed.language : "tr",
        riskObservations: Array.isArray(parsed.riskObservations)
          ? parsed.riskObservations.filter((r: unknown) => typeof r === "string")
          : [],
        visualObservations: Array.isArray(parsed.visualObservations)
          ? parsed.visualObservations.filter((r: unknown) => typeof r === "string")
          : [],
        sourceType: "video",
      };
    } catch (err) {
      console.error("VideoAnalysisAgent: Gemini hatası:", err);
      return null;
    }
  }
}
