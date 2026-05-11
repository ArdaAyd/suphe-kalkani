import { extractionAgent } from "./extractionAgent";
import { validationAgent } from "./validationAgent";
import { judgementAgent } from "./judgementAgent";

type OrchestratorInput = {
  text: string;
  imageBase64?: string;
  imageMimeType?: string;
};

export async function orchestrator(input: OrchestratorInput) {
  console.log("Orchestrator başladı");

  const extractionResult = await extractionAgent(input);

  const validationResult = await validationAgent(extractionResult);

  const judgementResult = await judgementAgent(validationResult);

  console.log("Orchestrator tamamlandı");

  return {
    extraction: extractionResult,
    validation: validationResult,
    report: judgementResult,
  };
}