export async function validationAgent(data: {
  textSummary: string;
  urls: string[];
  ibans: string[];
  phones: string[];
  brandNames: string[];
  claims: string[];
  urgencyPhrases: string[];
}) {
  console.log("Validation Agent çalıştı");

  const redFlags: string[] = [];

  let urgencyRisk = 0;

  if (data.urgencyPhrases.length > 0) {
    urgencyRisk = 70;
    redFlags.push("Aciliyet dili tespit edildi");
  }

  return {
    urlRisk: 0,
    ibanRisk: 0,
    urgencyRisk,
    brandSpoofRisk: 0,
    redFlags,
  };
}