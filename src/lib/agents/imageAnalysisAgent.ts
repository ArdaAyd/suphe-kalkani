import { ai } from "@/lib/gemini/client";

export type ImageAnalysisOutput = {
  isAiGenerated: boolean;
  aiGeneratedRisk: number; // 0-100 — görselin yapay/manipüle olma olasılığı
  verdict: string; // kısa Türkçe değerlendirme
  visualObservations: string[]; // görsel manipülasyon/sahtelik belirtileri
};

function clampScore(n: unknown): number {
  const v = Number(n);
  if (isNaN(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Yüklenen görselin yapay zeka ile üretilmiş, deepfake veya dijital olarak
 * manipüle edilmiş olup olmadığını tespit eder.
 *
 * Extraction Agent görselden metin/URL/marka çıkarırken, bu ajan görselin
 * KENDİSİNİN sahte olup olmadığına bakar. Orchestrator iki ajanı paralel
 * çalıştırır; bu yüzden ekstra gecikme oluşmaz.
 */
export class ImageAnalysisAgent {
  name = "ImageAnalysisAgent";

  async analyze(
    imageBase64: string,
    mimeType = "image/jpeg"
  ): Promise<ImageAnalysisOutput | null> {
    const prompt = `Bu görseli SADECE görsel doğruluk (authenticity) açısından analiz et. Amacın görselin yapay zeka ile üretilmiş, deepfake veya dijital olarak manipüle edilmiş olup olmadığını tespit etmek.

İncele:
1. Yapay zeka üretimi izleri (diffusion/GAN): doğal olmayan cilt/doku, bozuk el/parmaklar, görseldeki anlamsız/çarpık yazılar, asimetrik yüz hatları, tutarsız ışık ve gölgeler, arka planda erime/bozulma.
2. Deepfake / yüz manipülasyonu: yüz birleştirme izleri, uyumsuz cilt tonu, doğal olmayan göz/diş, yüz kenarlarında bulanıklık.
3. Sahte veya manipüle edilmiş marka logosu — orijinalinden farklı renk, oran veya yazı tipi.
4. Sahte ekran görüntüsü — uydurma banka uygulaması, sahte SMS, sahte ödeme/bildirim ekranı, gerçekçi olmayan arayüz.
5. Photoshop / dijital düzenleme izleri — kopyalanmış bölgeler, kenar artefaktları, tutarsız çözünürlük.

Değerlendirme:
- aiGeneratedRisk: 0-100. Görsel net gerçekse 0-15, şüpheli izler varsa 40-65, yüksek olasılıkla yapay/manipüle ise 75-100.
- isAiGenerated: aiGeneratedRisk 60 ve üzeriyse true.
- Gözlemlerde net ol; uygun olduğunda "yapay zeka ile üretilmiş", "deepfake", "manipüle edilmiş", "yapay görünüm" ifadelerini kullan.

Sadece JSON döndür, markdown kullanma:
{
  "isAiGenerated": true veya false,
  "aiGeneratedRisk": 0-100 arası sayı,
  "verdict": "tek cümle Türkçe değerlendirme",
  "visualObservations": ["görsel manipülasyon/sahtelik belirtileri, Türkçe — yoksa boş liste"]
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
                  data: imageBase64,
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

      const aiGeneratedRisk = clampScore(parsed.aiGeneratedRisk);

      return {
        isAiGenerated:
          typeof parsed.isAiGenerated === "boolean"
            ? parsed.isAiGenerated
            : aiGeneratedRisk >= 60,
        aiGeneratedRisk,
        verdict: typeof parsed.verdict === "string" ? parsed.verdict : "",
        visualObservations: Array.isArray(parsed.visualObservations)
          ? parsed.visualObservations.filter(
              (r: unknown) => typeof r === "string"
            )
          : [],
      };
    } catch (err) {
      console.error("ImageAnalysisAgent: Gemini hatası:", err);
      return null;
    }
  }
}
