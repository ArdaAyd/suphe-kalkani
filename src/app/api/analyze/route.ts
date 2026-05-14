import { NextRequest, NextResponse } from "next/server";
import { orchestrator } from "@/lib/agents/orchestrator";
import { checkRateLimit } from "@/lib/utils/rateLimit";
import fs from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";

async function fileToBase64(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return buffer.toString("base64");
}

// Geçici audio dosyası kaydetmek için yardımcı
async function saveTempFile(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const tempPath = path.join(os.tmpdir(), `${Date.now()}_${file.name}`);
  await fs.promises.mkdir(path.dirname(tempPath), { recursive: true });
  await fs.promises.writeFile(tempPath, buffer);
  return tempPath;
}

export async function POST(request: NextRequest) {
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0] ??
      request.headers.get("x-real-ip") ??
      "local-user";

    const rateLimit = checkRateLimit(ip);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Çok fazla analiz isteği gönderildi. Lütfen biraz sonra tekrar deneyin.",
        },
        { status: 429 }
      );
    }

    const contentType = request.headers.get("content-type") || "";

    let text = "";
    let imageBase64: string | undefined;
    let imageMimeType: string | undefined;
    let audioPath: string | undefined;
    let audioMimeType: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();

      const input = formData.get("input");
      const file = formData.get("file");
      const audioFile = formData.get("audio");

      if (typeof input === "string") {
        text = input;
      }

      if (file instanceof File) {
        imageBase64 = await fileToBase64(file);
        imageMimeType = file.type;
      }

      if (audioFile instanceof File) {
        audioPath = await saveTempFile(audioFile);
        const ext = audioFile.name.split(".").pop()?.toLowerCase();
        const extMimeMap: Record<string, string> = {
          mp3: "audio/mpeg",
          mp4: "audio/mp4",
          m4a: "audio/mp4",
          wav: "audio/wav",
          webm: "audio/webm",
          ogg: "audio/ogg",
          flac: "audio/flac",
        };
        audioMimeType = audioFile.type || (ext ? extMimeMap[ext] : undefined) || "audio/mpeg";
      }

      console.log("[api/analyze] payload", {
        textLength: text.trim().length,
        image: file instanceof File
          ? { name: (file as File).name, type: (file as File).type, size: (file as File).size }
          : null,
        audio: audioFile instanceof File
          ? { name: audioFile.name, type: audioFile.type, size: audioFile.size }
          : null,
      });
    } else {
      const body = await request.json();
      text = body.input ?? "";
    }

    if (!text.trim() && !imageBase64 && !audioPath) {
      return NextResponse.json(
        { error: "Analiz edilecek içerik gönderilmedi." },
        { status: 400 }
      );
    }

    const result = await orchestrator({
      text,
      imageBase64,
      imageMimeType,
      audioPath,
      audioMimeType,
    });

    // İşlemden sonra geçici audio dosyasını sil
    if (audioPath) {
      fs.promises.unlink(audioPath).catch(() => {});
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Analyze API error:", error);
    return NextResponse.json(
      { error: "Analiz sırasında bir hata oluştu." },
      { status: 500 }
    );
  }
}