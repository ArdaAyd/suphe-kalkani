"use client";

import { useState, useEffect } from "react";

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
  validation: {
    urlRisk: number;
    ibanRisk: number;
    urgencyRisk: number;
    brandSpoofRisk: number;
    redFlags: string[];
    reasoning?: string;
  };
  report: {
    finalScore: number;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    summary: string;
    redFlags: string[];
    recommendedActions: string[];
    confidence: number;
  };
  audio?: {
    transcript: string;
    language: string;
    riskObservations: string[];
  };
};

const LOADING_STEPS = [
  { label: "Extraction Agent", description: "İçerik ayrıştırılıyor, URL/IBAN/marka tespiti yapılıyor..." },
  { label: "Validation Agent", description: "Risk skorları hesaplanıyor, kırmızı bayraklar belirleniyor..." },
  { label: "Judgement Agent", description: "Final risk raporu sentezleniyor..." },
];

const RISK_LABELS: Record<"LOW" | "MEDIUM" | "HIGH", string> = {
  LOW: "DÜŞÜK",
  MEDIUM: "ORTA",
  HIGH: "YÜKSEK",
};

const RISK_COLORS: Record<"LOW" | "MEDIUM" | "HIGH", string> = {
  LOW: "bg-green-500",
  MEDIUM: "bg-yellow-500",
  HIGH: "bg-red-500",
};

export default function Home() {
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [audioPreview, setAudioPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading) {
      setCurrentStep(0);
      return;
    }
    const interval = setInterval(() => {
      setCurrentStep((prev) => Math.min(prev + 1, LOADING_STEPS.length - 1));
    }, 1800);
    return () => clearInterval(interval);
  }, [loading]);

  // Ses dosyası için URL temizliği (memory leak önlemi)
  useEffect(() => {
    return () => {
      if (audioPreview) URL.revokeObjectURL(audioPreview);
    };
  }, [audioPreview]);

  function handleFileChange(selectedFile: File | null) {
    setFile(selectedFile);
    if (selectedFile) {
      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target?.result as string);
      reader.readAsDataURL(selectedFile);
    } else {
      setImagePreview(null);
    }
  }

  function handleAudioChange(selectedFile: File | null) {
    if (audioPreview) URL.revokeObjectURL(audioPreview);
    setAudioFile(selectedFile);
    if (selectedFile) {
      setAudioPreview(URL.createObjectURL(selectedFile));
    } else {
      setAudioPreview(null);
    }
  }

  async function handleAnalyze() {
    setError("");
    if (!input.trim() && !file && !audioFile) {
      setError("Lütfen metin, görsel veya ses dosyası ekleyin.");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("input", input);
      if (file) formData.append("file", file);
      if (audioFile) formData.append("audio", audioFile);

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
    } catch (err) {
      console.error(err);
      setError("Sunucuya bağlanırken bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-3xl bg-zinc-900 rounded-3xl p-8 shadow-2xl border border-zinc-800">
        <h1 className="text-4xl font-bold mb-2">ŞüpheKalkanı</h1>

        <p className="text-zinc-400 mb-8">
          Dolandırıcılık risklerini agentic AI ile analiz edin.
        </p>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Mesajı, kampanya metnini veya şüpheli içeriği buraya yapıştırın..."
          className="w-full h-40 rounded-2xl bg-zinc-800 border border-zinc-700 p-4 text-white outline-none resize-none"
        />

        {/* Görsel yükle */}
        <div className="mt-4 rounded-2xl border border-dashed border-zinc-700 bg-zinc-800 p-4">
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Görsel yükle
          </label>

          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-zinc-400 file:mr-4 file:rounded-xl file:border-0 file:bg-red-500 file:px-4 file:py-2 file:text-white hover:file:bg-red-600"
          />

          {imagePreview && (
            <div className="mt-3">
              <img
                src={imagePreview}
                alt="Yüklenen görsel"
                className="max-h-48 rounded-xl object-contain border border-zinc-600"
              />
              <div className="mt-1 flex items-center justify-between">
                <p className="text-xs text-zinc-500">{file?.name}</p>
                <button
                  type="button"
                  onClick={() => handleFileChange(null)}
                  className="text-xs text-zinc-400 hover:text-red-400"
                >
                  Kaldır
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Ses yükle */}
        <div className="mt-4 rounded-2xl border border-dashed border-zinc-700 bg-zinc-800 p-4">
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Ses yükle
          </label>

          <input
            type="file"
            accept="audio/*"
            onChange={(e) => handleAudioChange(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-zinc-400 file:mr-4 file:rounded-xl file:border-0 file:bg-red-500 file:px-4 file:py-2 file:text-white hover:file:bg-red-600"
          />

          {audioPreview && (
            <div className="mt-3">
              <audio controls src={audioPreview} className="w-full" />
              <div className="mt-1 flex items-center justify-between">
                <p className="text-xs text-zinc-500">{audioFile?.name}</p>
                <button
                  type="button"
                  onClick={() => handleAudioChange(null)}
                  className="text-xs text-zinc-400 hover:text-red-400"
                >
                  Kaldır
                </button>
              </div>
            </div>
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
          <div className="mt-6 rounded-2xl border border-zinc-700 bg-zinc-800 p-4">
            <p className="mb-4 font-semibold text-zinc-200">
              Ajan pipeline&apos;ı çalışıyor...
            </p>
            <div className="space-y-3">
              {LOADING_STEPS.map((step, index) => {
                const isDone = index < currentStep;
                const isActive = index === currentStep;
                return (
                  <div key={index} className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-600">
                      {isDone ? (
                        <span className="text-xs text-green-400">✓</span>
                      ) : isActive ? (
                        <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-zinc-600" />
                      )}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${isDone ? "text-green-400" : isActive ? "text-white" : "text-zinc-600"}`}>
                        {step.label}
                      </p>
                      <p className={`text-xs mt-0.5 ${isActive ? "text-zinc-400" : "text-zinc-600"}`}>
                        {step.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-8 rounded-2xl bg-zinc-800 border border-zinc-700 p-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Risk Raporu</h2>
              <span className={`px-4 py-2 rounded-full text-sm font-semibold ${RISK_COLORS[result.report.riskLevel]}`}>
                {RISK_LABELS[result.report.riskLevel]}
              </span>
            </div>

            {/* Score + confidence */}
            <div className="mt-6 flex items-end gap-6">
              <div>
                <p className="text-zinc-400 text-sm">Risk Skoru</p>
                <p className="text-5xl font-bold mt-1">
                  {result.report.finalScore}
                  <span className="text-2xl text-zinc-500">/100</span>
                </p>
              </div>
              <div className="mb-1">
                <p className="text-zinc-400 text-sm">AI Güveni</p>
                <p className="text-lg font-semibold mt-1">%{result.report.confidence}</p>
              </div>
            </div>

            {/* Summary */}
            <div className="mt-6 rounded-xl bg-zinc-700/50 border border-zinc-700 p-4">
              <p className="text-zinc-400 text-sm mb-1">Özet</p>
              <p className="text-white">{result.report.summary}</p>
            </div>

            {/* Validation scores */}
            <div className="mt-6">
              <p className="text-zinc-400 text-sm mb-3">Validation Agent — Risk Boyutları</p>
              <div className="space-y-3">
                {(
                  [
                    { label: "URL Riski", value: result.validation.urlRisk },
                    { label: "IBAN Riski", value: result.validation.ibanRisk },
                    { label: "Aciliyet Riski", value: result.validation.urgencyRisk },
                    { label: "Marka Taklidi Riski", value: result.validation.brandSpoofRisk },
                  ] as const
                ).map(({ label, value }) => (
                  <div key={label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-zinc-300">{label}</span>
                      <span className={value >= 70 ? "text-red-400" : value >= 35 ? "text-yellow-400" : "text-green-400"}>
                        {value}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-zinc-700">
                      <div
                        className={`h-2 rounded-full transition-all ${value >= 70 ? "bg-red-500" : value >= 35 ? "bg-yellow-500" : "bg-green-500"}`}
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {result.validation.reasoning && (
                <div className="mt-3 rounded-xl border border-zinc-600 bg-zinc-700/40 p-3">
                  <p className="text-xs text-zinc-400 mb-1">Gemini Analiz Notu</p>
                  <p className="text-sm text-zinc-200 italic">{result.validation.reasoning}</p>
                </div>
              )}
            </div>

            {/* Extraction details */}
            <div className="mt-6">
              <p className="text-zinc-400 text-sm mb-3">Extraction Agent — Tespit Edilen Veriler</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-zinc-700 p-3">
                  <p className="text-xs text-zinc-400 mb-1">Markalar / Kurumlar</p>
                  <p className="text-sm">{result.extraction.brandNames.length > 0 ? result.extraction.brandNames.join(", ") : "—"}</p>
                </div>
                <div className="rounded-xl bg-zinc-700 p-3">
                  <p className="text-xs text-zinc-400 mb-1">URL</p>
                  <p className="text-sm break-all">{result.extraction.urls.length > 0 ? result.extraction.urls.join(", ") : "—"}</p>
                </div>
                <div className="rounded-xl bg-zinc-700 p-3">
                  <p className="text-xs text-zinc-400 mb-1">IBAN</p>
                  <p className="text-sm break-all">{result.extraction.ibans.length > 0 ? result.extraction.ibans.join(", ") : "—"}</p>
                </div>
                <div className="rounded-xl bg-zinc-700 p-3">
                  <p className="text-xs text-zinc-400 mb-1">Telefon</p>
                  <p className="text-sm">{result.extraction.phones.length > 0 ? result.extraction.phones.join(", ") : "—"}</p>
                </div>
                <div className="rounded-xl bg-zinc-700 p-3 sm:col-span-2">
                  <p className="text-xs text-zinc-400 mb-1">Aciliyet İfadeleri</p>
                  <p className="text-sm">{result.extraction.urgencyPhrases.length > 0 ? result.extraction.urgencyPhrases.join(", ") : "—"}</p>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <p className="text-zinc-400 mb-2">Kırmızı Bayraklar</p>
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
              <p className="text-zinc-400 mb-2">Önerilen Aksiyonlar</p>
              <ul className="space-y-2">
                {result.report.recommendedActions.map((action, index) => (
                  <li key={index} className="bg-zinc-700 rounded-xl p-3">
                    {action}
                  </li>
                ))}
              </ul>
            </div>

            {/* Ses Analizi — sadece ses yüklendiyse göster */}
            {result.audio && (
              <div className="mt-6 rounded-xl border border-zinc-700 bg-zinc-700/30 p-4">
                <p className="text-zinc-400 text-sm mb-3">Audio Agent — Ses Kaydı Analizi</p>

                {result.audio.transcript && (
                  <div className="mb-3">
                    <p className="text-xs text-zinc-400 mb-1">Transkript</p>
                    <p className="text-sm text-zinc-200 bg-zinc-800 rounded-xl p-3 leading-relaxed">
                      {result.audio.transcript}
                    </p>
                  </div>
                )}

                {result.audio.riskObservations.length > 0 && (
                  <div>
                    <p className="text-xs text-zinc-400 mb-2">Sesli Dolandırıcılık Tespitleri</p>
                    <ul className="space-y-1">
                      {result.audio.riskObservations.map((obs, i) => (
                        <li key={i} className="text-sm bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
                          {obs}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}