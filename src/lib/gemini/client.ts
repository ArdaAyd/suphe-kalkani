/*
Gemini bağlantısı — çoklu API key destekli rotation wrapper.

Birden fazla API key tanımlanabilir (GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3, ...).
Bir key 429 (RESOURCE_EXHAUSTED) alırsa otomatik olarak sıradaki key'e geçer.

Tüm agent dosyaları `ai.models.generateContent(...)` çağrısı yapıyor; wrapper bu çağrıyı
intercept edip rotation mantığını uyguluyor.
*/

import { GoogleGenAI } from "@google/genai";

// ─────────────────────────────────────────────
// API Key havuzunu yükle
// ─────────────────────────────────────────────
function loadApiKeys(): string[] {
  const keys: string[] = [];

  const primary = process.env.GEMINI_API_KEY;
  if (primary) keys.push(primary);

  // GEMINI_API_KEY_2, _3, _4, ... şeklinde tara
  for (let i = 2; i <= 10; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key) keys.push(key);
  }

  if (keys.length === 0) {
    throw new Error(
      "GEMINI_API_KEY bulunamadı. .env.local dosyasını kontrol edin."
    );
  }

  return keys;
}

const API_KEYS = loadApiKeys();
console.log(`[Gemini] ${API_KEYS.length} API key yüklendi`);

// Her key için bir GoogleGenAI instance hazırla
const clients: GoogleGenAI[] = API_KEYS.map(
  (apiKey) => new GoogleGenAI({ apiKey })
);

let currentKeyIndex = 0;

// ─────────────────────────────────────────────
// 429 hatası tespiti
// ─────────────────────────────────────────────
function isQuotaError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("429") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("quota") ||
    msg.includes("Quota")
  );
}

// ─────────────────────────────────────────────
// generateContent wrapper — key rotation ile
// ─────────────────────────────────────────────
type GenerateContentParams = Parameters<
  GoogleGenAI["models"]["generateContent"]
>[0];

async function generateContentWithRotation(
  params: GenerateContentParams
): Promise<Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>> {
  const startIndex = currentKeyIndex;
  let lastError: unknown;

  // Tüm key'leri sırayla dene
  for (let attempt = 0; attempt < clients.length; attempt++) {
    const index = (startIndex + attempt) % clients.length;
    const client = clients[index];

    try {
      const result = await client.models.generateContent(params);
      // Başarılı çağrı sonrası currentKey güncelle (next request bu key'den başlasın)
      currentKeyIndex = index;
      return result;
    } catch (err) {
      lastError = err;

      if (isQuotaError(err)) {
        console.warn(
          `[Gemini] Key #${index + 1} quota doldu, sıradaki key'e geçiliyor...`
        );
        continue;
      }

      // Quota dışı hata — fırlat
      throw err;
    }
  }

  // Tüm key'ler tükendi
  console.error("[Gemini] Tüm API key'ler quota doldu");
  throw lastError;
}

// ─────────────────────────────────────────────
// Public AI proxy
// ─────────────────────────────────────────────
// Agent dosyalarındaki mevcut kullanımı bozmamak için aynı arayüzü sunan bir proxy:
//   ai.models.generateContent({...})

export const ai = {
  models: {
    generateContent: generateContentWithRotation,
  },
};
