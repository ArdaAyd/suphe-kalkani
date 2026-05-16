import { extractionAgent } from "./extractionAgent";
import { validationAgent } from "./validationAgent";
import { judgementAgent } from "./judgementAgent";
import { AudioAnalysisAgent, type AudioAnalysisOutput } from "./audioAnalysisAgent";
import { VideoAnalysisAgent, type VideoAnalysisOutput } from "./videoAnalysisAgent";

type OrchestratorInput = {
  text: string;
  imageBase64?: string;
  imageMimeType?: string;
  audioPath?: string;
  audioMimeType?: string;
  videoPath?: string;
  videoMimeType?: string;
};

export async function orchestrator(input: OrchestratorInput) {
  console.log("Orchestrator başladı");

  const hasText = input.text.trim().length > 0;
  const hasImage = !!input.imageBase64;
  const hasAudio = !!input.audioPath;
  const hasVideo = !!input.videoPath;

  // --- Ses analizi ---
  let audioAnalysis: AudioAnalysisOutput | null = null;

  if (hasAudio) {
    console.log("Orchestrator: ses analizi başladı");
    const audioAgent = new AudioAnalysisAgent();
    audioAnalysis = await audioAgent.analyze(input.audioPath!, input.audioMimeType);
    console.log("Orchestrator: ses analizi tamamlandı, transcript uzunluğu:", audioAnalysis?.transcript?.length ?? 0);
  }

  // --- Video analizi (ses track'i üzerinden) ---
  let videoAnalysis: VideoAnalysisOutput | null = null;

  if (hasVideo) {
    console.log("Orchestrator: video ses analizi başladı");
    const videoAgent = new VideoAnalysisAgent();
    videoAnalysis = await videoAgent.analyze(input.videoPath!, input.videoMimeType);
    console.log("Orchestrator: video ses analizi tamamlandı, transcript uzunluğu:", videoAnalysis?.transcript?.length ?? 0);
  }

  // --- Ana text/image pipeline ---
  // Öncelik: metin > görsel > ses transkribi > video transkribi
  let pipelineText = hasText ? input.text : "";
  let isAudioTranscript = false;

  if (!hasText && !hasImage) {
    const transcript = audioAnalysis?.transcript || videoAnalysis?.transcript || "";
    if (transcript) {
      pipelineText = transcript;
      isAudioTranscript = true;
      console.log("Orchestrator: ses/video transkribi ana pipeline'a aktarıldı");
    }
  }

  const extractionResult = await extractionAgent({
    text: pipelineText,
    imageBase64: input.imageBase64,
    imageMimeType: input.imageMimeType,
    isAudioTranscript,
  });

  // Ses/video tespitlerini extraction sonucuna ekle (varsa)
  const mediaRiskObservations = [
    ...(audioAnalysis?.riskObservations ?? []),
    ...(videoAnalysis?.riskObservations ?? []),
    ...(videoAnalysis?.visualObservations ?? []),
  ];
  if (mediaRiskObservations.length > 0) {
    extractionResult.urgencyPhrases.push(
      ...mediaRiskObservations.filter(
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
    ...(videoAnalysis ? { video: videoAnalysis } : {}),
  };
}
