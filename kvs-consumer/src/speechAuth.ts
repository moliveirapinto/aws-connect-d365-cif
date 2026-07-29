// Supplies Microsoft Entra authorization tokens for the Azure AI Speech SDK.
//
// The subscription disables local (key) auth on Cognitive Services
// (disableLocalAuth=true via Azure Policy), so we authenticate with the
// container's managed identity. The Speech SDK expects the token in the form
//   aad#{speechResourceId}#{entraAccessToken}
// (https://learn.microsoft.com/azure/ai-services/speech-service/how-to-configure-azure-ad-auth)

import { DefaultAzureCredential } from "@azure/identity";
import { env } from "./env.js";

const SCOPE = "https://cognitiveservices.azure.com/.default";
const credential = new DefaultAzureCredential();

/** Fetch a fresh Speech authorization token (aad#resourceId#accessToken). */
export async function getSpeechAuthToken(): Promise<string> {
  const resourceId = env.speechResourceId;
  if (!resourceId) {
    throw new Error("AZURE_SPEECH_RESOURCE_ID is required for Entra Speech auth.");
  }
  const token = await credential.getToken(SCOPE);
  if (!token?.token) throw new Error("Failed to acquire Entra token for Speech.");
  return `aad#${resourceId}#${token.token}`;
}
