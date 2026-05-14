import { extractionAgent } from "./extractionAgent";
import { validationAgent } from "./validationAgent";
import { judgementAgent } from "./judgementAgent";
import { AudioAnalysisAgent, type AudioAnalysisOutput } from "./audioAnalysisAgent";

type OrchestratorInput = {
  text: string;
  imageBase64?: string;
  imageMimeType?: string;
  audioPath?: string;
  audioMimeType?: string;
};

export async function orchestrator(input: OrchestratorInput) {
  console.log("Orchestrator başladı");

  const hasText = input.text.trim().length > 0;
  const hasImage = !!input.imageBase64;
  const hasAudio = !!input.audioPath;

  // --- Ses analizi ---
  let audioAnalysis: AudioAnalysisOutput | null = null;

  if (hasAudio) {
    console.log("Orchestrator: ses analizi başladı");
    const audioAgent = new AudioAnalysisAgent();
    audioAnalysis = await audioAgent.analyze(input.audioPath!, input.audioMimeType);
    console.log("Orchestrator: ses analizi tamamlandı, transcript uzunluğu:", audioAnalysis?.transcript?.length ?? 0);
  }

  // --- Ana text/image pipeline ---
  // Eğer metin veya görsel varsa çalıştır.
  // Ses varsa ama metin/görsel yoksa, transcript'i ana metin olarak kullan.
  let pipelineText = hasText ? input.text : "";
  let isAudioTranscript = false;

  if (!hasText && !hasImage && audioAnalysis?.transcript) {
    pipelineText = audioAnalysis.transcript;
    isAudioTranscript = true;
    console.log("Orchestrator: ses transkribi ana pipeline'a aktarıldı");
  }

  const extractionResult = await extractionAgent({
    text: pipelineText,
    imageBase64: input.imageBase64,
    imageMimeType: input.imageMimeType,
    isAudioTranscript,
  });

  // Ses tespitlerini extraction sonucuna ekle (varsa)
  if (audioAnalysis?.riskObservations && audioAnalysis.riskObservations.length > 0) {
    extractionResult.urgencyPhrases.push(
      ...audioAnalysis.riskObservations.filter(
        (obs) => !extractionResult.urgencyPhrases.includes(obs)
      )
    );
  }

  const validationResult = await validationAgent(extractionResult, isAudioTranscript);
  const judgementResult = await judgementAgent(validationResult, extractionResult, isAudioTranscript);

  console.log("Orchestrator tamamlandı");

  return {
    extraction: extractionResult,
    validation: validationResult,
    report: judgementResult,
    ...(audioAnalysis ? { audio: audioAnalysis } : {}),
  };
}
