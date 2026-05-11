export async function extractionAgent(input: string) {
  console.log("Extraction Agent çalıştı");

  return {
    textSummary: input,
    urls: [],
    ibans: [],
    phones: [],
    brandNames: [],
    claims: [],
    urgencyPhrases: [],
  };
}