"use client";

import { useState, useEffect, useRef } from "react";

type AnalyzeResponse = {
  extraction: {
    textSummary: string;
    urls: string[];
    ibans: string[];
    phones: string[];
    brandNames: string[];
    claims: string[];
    urgencyPhrases: string[];
    priceClaims?: string[];
    giveawayPhrases?: string[];
    discountClaims?: string[];
    senderEmails?: string[];
  };
  validation: {
    urlRisk: number;
    ibanRisk: number;
    urgencyRisk: number;
    brandSpoofRisk: number;
    ecommerceRisk?: number;
    deepfakeRisk?: number;
    deepfakeSignals?: string[];
    redFlags: string[];
    reasoning?: string;
    webSearchQueries?: string[];
    toolCalls?: string[];
  };
  report: {
    finalScore: number;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    headline: string;
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
  video?: {
    transcript: string;
    language: string;
    riskObservations: string[];
    visualObservations: string[];
    sourceType: "video";
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

const RISK_HERO_STYLES: Record<"LOW" | "MEDIUM" | "HIGH", string> = {
  LOW: "bg-gradient-to-br from-green-500/20 to-green-500/5 border-green-500/40",
  MEDIUM: "bg-gradient-to-br from-yellow-500/20 to-yellow-500/5 border-yellow-500/40",
  HIGH: "bg-gradient-to-br from-red-500/25 to-red-500/5 border-red-500/40",
};

const RISK_ICONS: Record<"LOW" | "MEDIUM" | "HIGH", string> = {
  LOW: "✓",
  MEDIUM: "⚠️",
  HIGH: "🚨",
};

const RISK_ICON_COLORS: Record<"LOW" | "MEDIUM" | "HIGH", string> = {
  LOW: "text-green-400",
  MEDIUM: "text-yellow-400",
  HIGH: "text-red-400",
};

export default function Home() {
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [audioPreview, setAudioPreview] = useState<string | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    return () => {
      if (audioPreview) URL.revokeObjectURL(audioPreview);
    };
  }, [audioPreview]);

  useEffect(() => {
    return () => {
      if (videoPreview) URL.revokeObjectURL(videoPreview);
    };
  }, [videoPreview]);

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

  function handleVideoChange(selectedFile: File | null) {
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideoFile(selectedFile);
    if (selectedFile) {
      setVideoPreview(URL.createObjectURL(selectedFile));
    } else {
      setVideoPreview(null);
    }
  }

  function handleFileDrop(dropped: File) {
    if (dropped.type.startsWith("image/")) {
      handleFileChange(dropped);
    } else if (dropped.type.startsWith("audio/")) {
      handleAudioChange(dropped);
    } else if (dropped.type.startsWith("video/")) {
      handleVideoChange(dropped);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function onDragLeave(e: React.DragEvent) {
    // Sadece zone dışına çıkınca kapansın (child elementlere geçişte kapanmasın)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileDrop(dropped);
  }

  async function handleAnalyze() {
    setError("");
    if (!input.trim() && !file && !audioFile && !videoFile) {
      setError("Lütfen metin, görsel, ses veya video ekleyin.");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("input", input);
      if (file) formData.append("file", file);
      if (audioFile) formData.append("audio", audioFile);
      if (videoFile) formData.append("video", videoFile);

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

  const hasMedia = !!imagePreview || !!audioPreview || !!videoPreview;

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

        {/* Unified drag-and-drop media zone */}
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => !hasMedia && fileInputRef.current?.click()}
          className={`mt-4 rounded-2xl border-2 border-dashed transition-all
            ${isDragging
              ? "border-red-500 bg-red-500/10 scale-[1.01]"
              : hasMedia
              ? "border-zinc-700 bg-zinc-800 cursor-default"
              : "border-zinc-700 bg-zinc-800 hover:border-zinc-500 cursor-pointer"
            }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,audio/*,video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileDrop(f);
              e.target.value = "";
            }}
          />

          {/* Drop prompt — sadece hiç dosya yokken göster */}
          {!hasMedia && (
            <div className="p-6 text-center select-none">
              <p className="text-zinc-300 font-medium">Dosya sürükleyip bırakın</p>
              <p className="text-zinc-500 text-sm mt-1">veya tıklayarak seçin</p>
              <p className="text-zinc-600 text-xs mt-2">Fotoğraf · Ses · Video</p>
            </div>
          )}

          {/* Yüklenen dosyaların önizlemesi */}
          {hasMedia && (
            <div className="p-4 space-y-3">
              {/* Görsel önizleme */}
              {imagePreview && (
                <div>
                  <img
                    src={imagePreview}
                    alt="Yüklenen görsel"
                    className="max-h-48 rounded-xl object-contain border border-zinc-600"
                  />
                  <div className="mt-1 flex items-center justify-between">
                    <p className="text-xs text-zinc-500">{file?.name}</p>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleFileChange(null); }}
                      className="text-xs text-zinc-400 hover:text-red-400 transition-colors"
                    >
                      Kaldır
                    </button>
                  </div>
                </div>
              )}

              {/* Ses önizleme */}
              {audioPreview && (
                <div>
                  <audio controls src={audioPreview} className="w-full" />
                  <div className="mt-1 flex items-center justify-between">
                    <p className="text-xs text-zinc-500">{audioFile?.name}</p>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleAudioChange(null); }}
                      className="text-xs text-zinc-400 hover:text-red-400 transition-colors"
                    >
                      Kaldır
                    </button>
                  </div>
                </div>
              )}

              {/* Video önizleme */}
              {videoPreview && (
                <div>
                  <video
                    controls
                    src={videoPreview}
                    className="w-full rounded-xl max-h-48 object-contain bg-black"
                  />
                  <div className="mt-1 flex items-center justify-between">
                    <p className="text-xs text-zinc-500">{videoFile?.name}</p>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleVideoChange(null); }}
                      className="text-xs text-zinc-400 hover:text-red-400 transition-colors"
                    >
                      Kaldır
                    </button>
                  </div>
                </div>
              )}

              {/* Dosya ekle butonu — önizleme varken */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                + Başka dosya ekle
              </button>
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
          <div className="mt-8 space-y-4">
            {/* ============================================== */}
            {/* LAYER 1 — HERO VERDICT (en kritik bilgi)       */}
            {/* ============================================== */}
            <div className={`rounded-3xl border-2 p-8 text-center ${RISK_HERO_STYLES[result.report.riskLevel]}`}>
              <div className={`text-7xl mb-4 ${RISK_ICON_COLORS[result.report.riskLevel]}`}>
                {RISK_ICONS[result.report.riskLevel]}
              </div>
              <div className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold mb-4 ${RISK_COLORS[result.report.riskLevel]}`}>
                {RISK_LABELS[result.report.riskLevel]} RİSK
              </div>
              <p className="text-xl sm:text-2xl font-semibold text-white leading-snug max-w-2xl mx-auto">
                {result.report.headline}
              </p>
            </div>

            {/* ============================================== */}
            {/* LAYER 2 — NE YAPMALISINIZ (eylem)              */}
            {/* ============================================== */}
            {result.report.recommendedActions.length > 0 && (
              <div className="rounded-2xl bg-zinc-800 border border-zinc-700 p-6">
                <p className="text-zinc-300 font-semibold mb-4 flex items-center gap-2">
                  <span className="text-xl">⚡</span>
                  <span>Ne Yapmalısınız?</span>
                </p>
                <ul className="space-y-2">
                  {result.report.recommendedActions.slice(0, 3).map((action, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-3 bg-zinc-700/40 border-l-4 border-red-500 rounded-r-xl p-4"
                    >
                      <span className="shrink-0 mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold">
                        {i + 1}
                      </span>
                      <span className="text-white">{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ============================================== */}
            {/* LAYER 3 — NEDEN ŞÜPHELİ (kısa neden)            */}
            {/* ============================================== */}
            {result.report.redFlags.length > 0 && result.report.riskLevel !== "LOW" && (
              <div className="rounded-2xl bg-zinc-800 border border-zinc-700 p-6">
                <p className="text-zinc-300 font-semibold mb-4 flex items-center gap-2">
                  <span className="text-xl">🔍</span>
                  <span>Neden Şüpheli?</span>
                </p>
                <ul className="space-y-2">
                  {result.report.redFlags.slice(0, 3).map((flag, i) => (
                    <li key={i} className="flex items-start gap-2 text-zinc-200">
                      <span className="text-red-400 mt-1 shrink-0">•</span>
                      <span>{flag}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ============================================== */}
            {/* LAYER 4 — TEKNİK DETAYLAR (opsiyonel accordion) */}
            {/* ============================================== */}
            <details className="rounded-2xl bg-zinc-800/60 border border-zinc-700 group">
              <summary className="cursor-pointer list-none p-5 text-zinc-300 font-medium select-none hover:text-white flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="text-lg">🔬</span>
                  <span>Teknik Detaylar</span>
                </span>
                <span className="text-zinc-500 text-xs transition-transform group-open:rotate-180">▼</span>
              </summary>

              <div className="px-5 pb-6 space-y-6 border-t border-zinc-700/50 pt-5">
                {/* Risk Skoru + Güven */}
                <div className="flex flex-wrap items-end gap-6">
                  <div>
                    <p className="text-zinc-400 text-xs">Risk Skoru</p>
                    <p className="text-4xl font-bold mt-1">
                      {result.report.finalScore}
                      <span className="text-xl text-zinc-500">/100</span>
                    </p>
                  </div>
                  <div className="mb-1">
                    <p className="text-zinc-400 text-xs">AI Güveni</p>
                    <p className="text-base font-semibold mt-1">%{result.report.confidence}</p>
                  </div>
                </div>

                {/* Detaylı özet */}
                <div className="rounded-xl bg-zinc-700/40 border border-zinc-700 p-4">
                  <p className="text-zinc-400 text-xs mb-1">Detaylı Analiz</p>
                  <p className="text-sm text-zinc-200 leading-relaxed">{result.report.summary}</p>
                </div>

                {/* Validation skorları */}
                <div>
                  <p className="text-zinc-400 text-xs mb-3">Risk Boyutları</p>
                  <div className="space-y-3">
                    {(
                      [
                        { label: "URL Riski", value: result.validation.urlRisk },
                        { label: "IBAN Riski", value: result.validation.ibanRisk },
                        { label: "Aciliyet Riski", value: result.validation.urgencyRisk },
                        { label: "Marka Taklidi Riski", value: result.validation.brandSpoofRisk },
                        { label: "E-Ticaret Riski", value: result.validation.ecommerceRisk ?? 0 },
                        { label: "AI / Deepfake Riski", value: result.validation.deepfakeRisk ?? 0 },
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

                {/* Tespit edilen veriler */}
                <div>
                  <p className="text-zinc-400 text-xs mb-3">Tespit Edilen Veriler</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-zinc-700/50 p-3">
                      <p className="text-xs text-zinc-400 mb-1">Markalar / Kurumlar</p>
                      <p className="text-sm">{result.extraction.brandNames.length > 0 ? result.extraction.brandNames.join(", ") : "—"}</p>
                    </div>
                    <div className="rounded-xl bg-zinc-700/50 p-3">
                      <p className="text-xs text-zinc-400 mb-1">URL</p>
                      <p className="text-sm break-all">{result.extraction.urls.length > 0 ? result.extraction.urls.join(", ") : "—"}</p>
                    </div>
                    <div className="rounded-xl bg-zinc-700/50 p-3">
                      <p className="text-xs text-zinc-400 mb-1">IBAN</p>
                      <p className="text-sm break-all">{result.extraction.ibans.length > 0 ? result.extraction.ibans.join(", ") : "—"}</p>
                    </div>
                    <div className="rounded-xl bg-zinc-700/50 p-3">
                      <p className="text-xs text-zinc-400 mb-1">Telefon</p>
                      <p className="text-sm">{result.extraction.phones.length > 0 ? result.extraction.phones.join(", ") : "—"}</p>
                    </div>
                    <div className="rounded-xl bg-zinc-700/50 p-3 sm:col-span-2">
                      <p className="text-xs text-zinc-400 mb-1">Aciliyet İfadeleri</p>
                      <p className="text-sm">{result.extraction.urgencyPhrases.length > 0 ? result.extraction.urgencyPhrases.join(", ") : "—"}</p>
                    </div>
                  </div>
                </div>

                {/* Tüm kırmızı bayraklar */}
                {result.report.redFlags.length > 0 && (
                  <div>
                    <p className="text-zinc-400 text-xs mb-2">Tüm Kırmızı Bayraklar ({result.report.redFlags.length})</p>
                    <ul className="space-y-2">
                      {result.report.redFlags.map((flag, index) => (
                        <li
                          key={index}
                          className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm"
                        >
                          {flag}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Tüm aksiyonlar */}
                {result.report.recommendedActions.length > 3 && (
                  <div>
                    <p className="text-zinc-400 text-xs mb-2">Tüm Önerilen Aksiyonlar</p>
                    <ul className="space-y-2">
                      {result.report.recommendedActions.map((action, index) => (
                        <li key={index} className="bg-zinc-700/50 rounded-xl p-3 text-sm">
                          {action}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Ses Analizi */}
                {result.audio && (
                  <div className="rounded-xl border border-zinc-700 bg-zinc-700/30 p-4">
                    <p className="text-zinc-400 text-xs mb-3">🎙 Ses Kaydı Analizi</p>

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

                {/* Video Analizi */}
                {result.video && (
                  <div className="rounded-xl border border-zinc-700 bg-zinc-700/30 p-4">
                    <p className="text-zinc-400 text-xs mb-3">🎬 Video Multimodal Analizi</p>

                    {result.video.transcript && (
                      <div className="mb-3">
                        <p className="text-xs text-zinc-400 mb-1">Transkript</p>
                        <p className="text-sm text-zinc-200 bg-zinc-800 rounded-xl p-3 leading-relaxed">
                          {result.video.transcript}
                        </p>
                      </div>
                    )}

                    {result.video.riskObservations.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs text-zinc-400 mb-2">🎙 Sesli Dolandırıcılık Tespitleri</p>
                        <ul className="space-y-1">
                          {result.video.riskObservations.map((obs, i) => (
                            <li key={i} className="text-sm bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
                              {obs}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {result.video.visualObservations.length > 0 && (
                      <div>
                        <p className="text-xs text-zinc-400 mb-2">👁 Görsel Dolandırıcılık Tespitleri</p>
                        <ul className="space-y-1">
                          {result.video.visualObservations.map((obs, i) => (
                            <li key={i} className="text-sm bg-orange-500/10 border border-orange-500/30 rounded-xl px-3 py-2">
                              {obs}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </details>
          </div>
        )}
      </div>
    </main>
  );
}
