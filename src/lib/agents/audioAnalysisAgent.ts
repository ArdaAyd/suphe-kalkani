import { ai } from "@/lib/gemini/client";
import fs from "fs";

export class AudioAnalysisAgent {
  name = "AudioAnalysisAgent";

  /**
   * Ses dosyasını hem transkripte çevirir hem de ton analizini yapar
   * @param filePath Ses dosyası yolu
   */
  async analyze(filePath: string, mimeType = "audio/mpeg") {
    const audioData = await fs.promises.readFile(filePath, { encoding: "base64" });

    const prompt = `
You are an audio analysis assistant.
Primary task (high priority): Transcribe the uploaded audio file into plain text.
Secondary task (lower priority): Analyze the tone, tempo, and pitch of the audio.
Return ONLY a valid JSON object with the following structure:
{
  "transcript": "full transcribed text",
  "tone": {
    "tempo": 120,          // approximate BPM
    "dominant_pitch": "C4",
    "key": "C major"
  }
}
No markdown, no code fences, just JSON.
`;

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
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text ?? "";

    try {
      return JSON.parse(text);
    } catch {
      return { error: "Gemini returned invalid JSON", raw: text };
    }
  }
}