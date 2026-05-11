import { NextRequest, NextResponse } from "next/server";
import { orchestrator } from "@/lib/agents/orchestrator";

async function fileToBase64(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return buffer.toString("base64");
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    let text = "";
    let imageBase64: string | undefined;
    let imageMimeType: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();

      const input = formData.get("input");
      const file = formData.get("file");

      if (typeof input === "string") {
        text = input;
      }

      if (file instanceof File) {
        imageBase64 = await fileToBase64(file);
        imageMimeType = file.type;
      }
    } else {
      const body = await request.json();
      text = body.input ?? "";
    }

    if (!text.trim() && !imageBase64) {
      return NextResponse.json(
        { error: "Analiz edilecek içerik gönderilmedi." },
        { status: 400 }
      );
    }

    const result = await orchestrator({
      text,
      imageBase64,
      imageMimeType,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Analyze API error:", error);

    return NextResponse.json(
      { error: "Analiz sırasında bir hata oluştu." },
      { status: 500 }
    );
  }
}