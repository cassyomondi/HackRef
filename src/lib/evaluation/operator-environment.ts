import "server-only";
import { loadEnvConfig } from "@next/env";
import { configuredGeminiModel } from "./model";

export function loadOperatorEnvironment(directory = process.cwd(), loader = loadEnvConfig) {
  const inherited = Object.hasOwn(process.env, "GEMINI_MODEL");
  // Same cwd/dev convention as cliDatabase/the durable worker; reads only.
  // Silence framework dotenv diagnostics so malformed files cannot echo values.
  const { loadedEnvFiles } = loader(directory, undefined, { info() {}, error() {} });
  const file = loadedEnvFiles.find((entry) => Object.hasOwn(entry.env, "GEMINI_MODEL"))?.path;
  const safeFile = file && /^\.env(?:\.(?:local|production|development|test)(?:\.local)?)?$/.test(file) ? file : null;
  return {
    selectedModel: configuredGeminiModel(),
    modelSource: inherited ? "PROCESS_ENVIRONMENT" : safeFile ? "ENV_FILE" : "DEFAULT",
    modelEnvFile: inherited ? null : safeFile,
  };
}
