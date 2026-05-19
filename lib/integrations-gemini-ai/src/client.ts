import { GoogleGenAI } from "@google/genai";

const directKey = process.env.Genini_api;
const proxyKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
const proxyBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

if (!directKey && !proxyKey) {
  throw new Error(
    "No Gemini API key found. Set Genini_api (direct) or AI_INTEGRATIONS_GEMINI_API_KEY (proxy).",
  );
}

export const ai = directKey
  ? new GoogleGenAI({ apiKey: directKey })
  : new GoogleGenAI({
      apiKey: proxyKey!,
      httpOptions: {
        apiVersion: "",
        baseUrl: proxyBase!,
      },
    });
