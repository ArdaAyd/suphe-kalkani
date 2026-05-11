import { NextRequest, NextResponse } from "next/server";
import { orchestrator } from "@/lib/agents/orchestrator";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const input = body.input;

    if (!input || typeof input !== "string") {
      return NextResponse.json(
        { error: "Analiz edilecek metin gönderilmedi." },
        { status: 400 }
      );
    }

    const result = await orchestrator(input);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Analyze API error:", error);

    return NextResponse.json(
      { error: "Analiz sırasında bir hata oluştu." },
      { status: 500 }
    );
  }
}