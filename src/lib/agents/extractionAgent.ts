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
    priceClaims: [],
    giveawayPhrases: [],
    discountClaims: [],
  };
}

export async function extractionAgent(input: ExtractionAgentInput) {
  console.log("Extraction Agent çalıştı");

  try {
    const prompt = `Sen bir dolandırıcılık tespit uzmanısın. Aşağıdaki şüpheli içeriği DİKKATLİ analiz et ve TÜM dolandırıcılık sinyallerini çıkar.

ÇOK ÖNEMLİ — Marka/Kurum tespiti:
İçerikte geçen HER markayı, kurum adını VEYA ürün ismini "brandNames" listesine MUTLAKA ekle. Atlama!
Örnek markalar (sınırlı değil, herhangi biri olabilir):
- Bankalar: Ziraat, Garanti, İş Bankası, Akbank, Yapı Kredi, Halkbank, Vakıfbank, Denizbank, QNB, Enpara
- E-ticaret: Trendyol, Hepsiburada, n11, Amazon, GittiGidiyor, Çiçek Sepeti, Hopi, Modanisa, LCWaikiki, Defacto, Boyner, Morhipo
- Yemek/Market: Yemeksepeti, Getir, Migros, BIM, A101, ŞOK, CarrefourSA
- Teknoloji: Teknosa, MediaMarkt, Vatan Bilgisayar, Arçelik, Beko
- Kargo: PTT, Aras, Yurtiçi, MNG, UPS, DHL
- Telekom: Turkcell, Vodafone, Türk Telekom
- Devlet: e-Devlet, SGK, GİB
- Yaşam: Decathlon, IKEA
- Veya yeni/küçük herhangi bir marka — sen tanımasan bile içerikte geçiyorsa LİSTELE.

E-Ticaret Sinyalleri (e-ticaret dolandırıcılığı için KRİTİK):
- "priceClaims": içerikte geçen fiyat iddiaları. Ürün adı + fiyat formatında ("iPhone 15 Pro 999 TL", "PS5 1.500 TL"). Sadece sayı/fiyat değil, ÜRÜN BAĞLAMI ile yaz.
- "giveawayPhrases": çekiliş/hediye/ödül kazanma vaadi içeren ifadeler ("iPhone kazandınız", "Tebrikler ödülünüz hazır", "Ücretsiz hediye").
- "discountClaims": indirim/kampanya iddiaları ("%80 indirim", "Black Friday özel", "Son 2 saat", "Stoklar tükeniyor").

Sadece geçerli JSON döndür. Markdown kullanma.

JSON formatı:
{
  "textSummary": "kısa özet (1-2 cümle)",
  "urls": ["tespit edilen URL'ler"],
  "ibans": ["tespit edilen IBAN'lar"],
  "phones": ["tespit edilen telefon numaraları"],
  "brandNames": ["GEÇEN HER markayı/kurumu/ürünü buraya yaz, atlama"],
  "claims": ["öne sürülen iddialar veya teklifler"],
  "urgencyPhrases": ["aciliyet/baskı yaratan ifadeler"],
  "priceClaims": ["ürün+fiyat iddiaları"],
  "giveawayPhrases": ["çekiliş/hediye/ödül vaadi"],
  "discountClaims": ["indirim/kampanya iddiaları"]
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