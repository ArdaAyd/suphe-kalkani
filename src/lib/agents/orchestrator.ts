import { extractionAgent } from "./extractionAgent";
import { validationAgent } from "./validationAgent";
import { judgementAgent } from "./judgementAgent";
import { AudioAnalysisAgent } from "./audioAnalysisAgent";

type OrchestratorInput = {
  text: string;
  imageBase64?: string;
  imageMimeType?: string;
  audioPath?: string; 
  audioMimeType?: string;
};

type AudioAnalysisResult = Awaited<ReturnType<AudioAnalysisAgent["analyze"]>> | null;

export async function orchestrator(input: OrchestratorInput) {
  console.log("Orchestrator başladı");

  // Text & image pipeline
  const extractionResult = await extractionAgent(input);
  const validationResult = await validationAgent(extractionResult);
  const judgementResult = await judgementAgent(validationResult, extractionResult);

  let audioAnalysisResult: AudioAnalysisResult = null;

  if (input.audioPath) {
    const audioAgent = new AudioAnalysisAgent();
    const audioResult = await audioAgent.analyze(
      input.audioPath,
      input.audioMimeType
    );
    console.log("Audio analizi tamamlandı:", audioResult);

    // Transcript varsa ana pipeline'a da dahil et
    if (audioResult?.transcript) {
      const audioTextExtraction = await extractionAgent({
        ...input,
        text: audioResult.transcript,
        isAudioTranscript: true,
      });
      const audioValidation = await validationAgent(audioTextExtraction, true);
      const audioJudgement = await judgementAgent(audioValidation, audioTextExtraction, true);

      // Ana extraction sonuçlarını audio bulguları ile zenginleştir (deduplicate)
      extractionResult.urls.push(...audioTextExtraction.urls.filter((u: string) => !extractionResult.urls.includes(u)));
      extractionResult.ibans.push(...audioTextExtraction.ibans.filter((i: string) => !extractionResult.ibans.includes(i)));
      extractionResult.phones.push(...audioTextExtraction.phones.filter((p: string) => !extractionResult.phones.includes(p)));
      extractionResult.urgencyPhrases.push(...audioTextExtraction.urgencyPhrases.filter((u: string) => !extractionResult.urgencyPhrases.includes(u)));

      audioAnalysisResult = {
        ...audioResult,
        extraction: audioTextExtraction,
        validation: audioValidation,
        report: audioJudgement,
      };
    } else {
      audioAnalysisResult = audioResult;
    }
  }

  console.log("Orchestrator tamamlandı");

  return {
    extraction: extractionResult,
    validation: validationResult,
    report: judgementResult,
    audio: audioAnalysisResult,
  };
}