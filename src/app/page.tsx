"use client";

import { useState } from "react";

type AnalyzeResponse = {
  extraction: {
    textSummary: string;
    urls: string[];
    ibans: string[];
    phones: string[];
    brandNames: string[];
    claims: string[];
    urgencyPhrases: string[];
  };
  report: {
    finalScore: number;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    summary: string;
    redFlags: string[];
    recommendedActions: string[];
    confidence: number;
  };
};

export default function Home() {
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState("");

  async function handleAnalyze() {
  if (!input.trim() && !file) return;

  setLoading(true);
  setResult(null);
  setError("");

  try {
    const formData = new FormData();

    formData.append("input", input);

    if (file) {
      formData.append("file", file);
    }

    const response = await fetch("/api/analyze", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Analiz sırasında bir hata oluştu.");
      return;
    }
    
    setResult(data);
  } catch (error) {
    console.error(error);
    setError("Sunucuya bağlanırken bir hata oluştu.");
  } finally {
    setLoading(false);
  }
}

  return (
    <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-3xl bg-zinc-900 rounded-3xl p-8 shadow-2xl border border-zinc-800">
        <h1 className="text-4xl font-bold mb-2">
          ŞüpheKalkanı
        </h1>

        <p className="text-zinc-400 mb-8">
          Dolandırıcılık risklerini agentic AI ile analiz edin.
        </p>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Mesajı, kampanya metnini veya şüpheli içeriği buraya yapıştırın..."
          className="w-full h-40 rounded-2xl bg-zinc-800 border border-zinc-700 p-4 text-white outline-none resize-none"
        />
        <div className="mt-4 rounded-2xl border border-dashed border-zinc-700 bg-zinc-800 p-4">
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Görsel yükle
          </label>

          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const selectedFile = e.target.files?.[0] ?? null;
              setFile(selectedFile);
            }}
            className="block w-full text-sm text-zinc-400 file:mr-4 file:rounded-xl file:border-0 file:bg-red-500 file:px-4 file:py-2 file:text-white hover:file:bg-red-600"
          />

          {file && (
            <p className="mt-3 text-sm text-zinc-400">
              Seçilen dosya: {file.name}
            </p>
          )}
        </div>

        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="mt-4 w-full rounded-2xl bg-red-500 hover:bg-red-600 transition-all py-4 font-semibold text-lg disabled:opacity-50"
        >
          {loading ? "Analiz ediliyor..." : "Analiz Et"}
        </button>

        {loading && (
            <div className="mt-6 bg-zinc-800 rounded-2xl p-4 border border-zinc-700">
              <p className="animate-pulse text-zinc-300">
                İçerik analiz ediliyor...
              </p>
            </div>
          )}

          {error && (
            <div className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">
              {error}
            </div>
          )}

        {result && (
          <div className="mt-8 rounded-2xl bg-zinc-800 border border-zinc-700 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">
                Risk Raporu
              </h2>

              <span
                className={`px-4 py-2 rounded-full text-sm font-semibold ${
                  result.report.riskLevel === "HIGH"
                    ? "bg-red-500"
                    : result.report.riskLevel === "MEDIUM"
                    ? "bg-yellow-500"
                    : "bg-green-500"
                }`}
              >
                {result.report.riskLevel}
              </span>
            </div>

            <div className="mt-6">
              <p className="text-zinc-400">
                Risk Skoru
              </p>

              <p className="text-5xl font-bold mt-2">
                {result.report.finalScore}/100
              </p>
            </div>

            <div className="mt-6">
              <p className="text-zinc-400 mb-3">
                AI Tespit Detayları
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-zinc-700 p-3">
                  <p className="text-sm text-zinc-400">Markalar</p>

                  <p className="mt-1">
                    {result.extraction.brandNames.length > 0
                      ? result.extraction.brandNames.join(", ")
                      : "Tespit edilmedi"}
                  </p>
                </div>

                <div className="rounded-xl bg-zinc-700 p-3">
                  <p className="text-sm text-zinc-400">URL</p>

                  <p className="mt-1 break-all">
                    {result.extraction.urls.length > 0
                      ? result.extraction.urls.join(", ")
                      : "Tespit edilmedi"}
                  </p>
                </div>

                <div className="rounded-xl bg-zinc-700 p-3">
                  <p className="text-sm text-zinc-400">IBAN</p>

                  <p className="mt-1 break-all">
                    {result.extraction.ibans.length > 0
                      ? result.extraction.ibans.join(", ")
                      : "Tespit edilmedi"}
                  </p>
                </div>

                <div className="rounded-xl bg-zinc-700 p-3">
                  <p className="text-sm text-zinc-400">
                    Aciliyet İfadeleri
                  </p>

                  <p className="mt-1">
                    {result.extraction.urgencyPhrases.length > 0
                      ? result.extraction.urgencyPhrases.join(", ")
                      : "Tespit edilmedi"}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <p className="text-zinc-400 mb-2">
                Özet
              </p>

              <p>{result.report.summary}</p>
            </div>

            <div className="mt-6">
              <p className="text-zinc-400 mb-2">
                Kırmızı Bayraklar
              </p>

              <ul className="space-y-2">
                {result.report.redFlags.map((flag, index) => (
                  <li
                    key={index}
                    className="bg-red-500/10 border border-red-500/30 rounded-xl p-3"
                  >
                    {flag}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6">
              <p className="text-zinc-400 mb-2">
                Önerilen Aksiyonlar
              </p>

              <ul className="space-y-2">
                {result.report.recommendedActions.map(
                  (action, index) => (
                    <li
                      key={index}
                      className="bg-zinc-700 rounded-xl p-3"
                    >
                      {action}
                    </li>
                  )
                )}
              </ul>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}