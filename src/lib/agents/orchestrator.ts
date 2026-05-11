import { extractionAgent } from "./extractionAgent";
import { validationAgent } from "./validationAgent";
import { judgementAgent } from "./judgementAgent";

export async function orchestrator(input: string) {
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