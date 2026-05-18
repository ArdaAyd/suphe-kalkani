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
// 503 / aşırı yük hatası tespiti
// ─────────────────────────────────────────────
function isOverloadError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("503") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("overloaded") ||
    msg.includes("high demand")
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_OVERLOAD_RETRIES = 3;

/**
 * Tüm Gemini API anahtarları kota (429) veya aşırı yük (503) nedeniyle
 * kullanılamadığında fırlatılır. Çağıran katmanlar bunu yakalayıp sahte
 * "güvenli" sonuç üretmek yerine kullanıcıya dürüst bir hata göstermelidir.
 */
export class GeminiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiUnavailableError";
  }
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

  // Tüm key'leri sırayla dene
  for (let attempt = 0; attempt < clients.length; attempt++) {
    const index = (startIndex + attempt) % clients.length;
    const client = clients[index];

    // 503 (model aşırı yüklü) genelde anlık bir spike'tır — aynı key ile
    // artan beklemeyle birkaç kez tekrar dene.
    for (let retry = 0; retry <= MAX_OVERLOAD_RETRIES; retry++) {
      try {
        const result = await client.models.generateContent(params);
        // Başarılı çağrı sonrası currentKey güncelle (next request bu key'den başlasın)
        currentKeyIndex = index;
        return result;
      } catch (err) {
        if (isOverloadError(err)) {
          if (retry < MAX_OVERLOAD_RETRIES) {
            const delay = 700 * 2 ** retry; // 700ms → 1.4s → 2.8s
            console.warn(
              `[Gemini] Model aşırı yüklü (503), ${delay}ms sonra tekrar (${retry + 1}/${MAX_OVERLOAD_RETRIES})...`
            );
            await sleep(delay);
            continue; // aynı key ile yeniden dene
          }
          // Aşırı yük denemeleri tükendi — servis kullanılamıyor
          throw new GeminiUnavailableError(
            "Gemini modeli şu an aşırı yüklü (503)."
          );
        }

        if (isQuotaError(err)) {
          console.warn(
            `[Gemini] Key #${index + 1} kotası doldu, sıradaki key'e geçiliyor...`
          );
          break; // iç döngüden çık → sıradaki key
        }

        // Quota / aşırı yük dışı hata — ham fırlat
        throw err;
      }
    }
  }

  // Tüm key'lerin kotası doldu
  console.error("[Gemini] Tüm API key'lerinin kotası doldu");
  throw new GeminiUnavailableError(
    "Tüm Gemini API anahtarlarının kotası doldu (429)."
  );
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
