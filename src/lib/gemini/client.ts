/*
Gemini bağlantısını tek merkezde tutuyor.
Agent dosyaları API key ile uğraşmadan buradan ai nesnesini kullanacak.
*/
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("GEMINI_API_KEY bulunamadı. .env.local dosyasını kontrol edin.");
}

export const ai = new GoogleGenAI({
  apiKey,
});