// Server-only. Never import this from a client component: GEMINI_API_KEY must stay out of the bundle.

/**
 * Default model for product extraction: a stable Flash-Lite model. Extraction is high-volume and the
 * endpoint is public, so cost per call matters more than peak reasoning. Set GEMINI_MODEL to a larger
 * stable Flash model (see https://ai.google.dev/gemini-api/docs/models) if extraction quality needs it.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export type GeminiConfig = { apiKey: string; model: string };

export type GeminiConfigResult =
  | { ok: true; config: GeminiConfig }
  | { ok: false; reason: "missing_key" | "invalid_model" };

const modelPattern = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

export function getGeminiConfig(env: Record<string, string | undefined> = process.env): GeminiConfigResult {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "missing_key" };

  // "models/gemini-..." is the API resource name; accept it but store the bare id.
  const requested = env.GEMINI_MODEL?.trim().replace(/^models\//, "");
  const model = requested || DEFAULT_GEMINI_MODEL;
  if (!modelPattern.test(model)) return { ok: false, reason: "invalid_model" };

  return { ok: true, config: { apiKey, model } };
}
