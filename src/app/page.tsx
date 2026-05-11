"use client";

import { useState } from "react";

type AnalyzeResponse = {
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
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  async function handleAnalyze() {
    if (!input.trim()) return;

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input,
        }),
      });

      const data = await response.json();

      setResult(data);
    } catch (error) {
      console.error(error);
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