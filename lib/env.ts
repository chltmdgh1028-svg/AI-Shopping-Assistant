// Server-only. Never import this from a client component: GEMINI_API_KEY must stay out of the bundle.

/**
 * Default model for product extraction: a stable Flash-Lite model. Extraction is high-volume and the
 * endpoint is public, so cost per call matters more than peak reasoning.
 *
 * Checked against Google's models page, pricing page and changelog (October 2026): gemini-3.5-flash-lite
 * is listed as a stable (GA since 2026-07-21) model, USD 0.30 in / 2.50 out per 1M tokens, and is not
 * deprecated. gemini-3.8-flash is the newest stable Flash model at USD 0.75 / 3.75; set GEMINI_MODEL to
 * it (or another id from https://ai.google.dev/gemini-api/docs/models) if extraction quality needs it.
 * Model ids change over time, which is why this is an environment variable and not hard-coded.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

/**
 * Availability-ordered fallback chain, used after the primary model fails with a rate limit, quota,
 * unavailable-model or 5xx error. Every id was listed on Google's models page in October 2026;
 * `gemini-3.1-flash` and a bare `gemini-3-flash` do not exist as text models (the latter is only
 * published as `gemini-3-flash-preview`). The 2.5 models are limited to accounts that used them
 * before, so they sit last and simply 404 for everyone else.
 */
export const GEMINI_FALLBACK_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.8-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
] as const;

export type GeminiConfig = { apiKey: string; models: string[] };

export type GeminiConfigResult =
  | { ok: true; config: GeminiConfig }
  | { ok: false; reason: "missing_key" | "invalid_model" };

const modelPattern = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

export function getGeminiConfig(env: Record<string, string | undefined> = process.env): GeminiConfigResult {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "missing_key" };

  // "models/gemini-..." is the API resource name; accept it but store the bare id.
  const requested = env.GEMINI_MODEL?.trim().replace(/^models\//, "");
  const primary = requested || DEFAULT_GEMINI_MODEL;
  if (!modelPattern.test(primary)) return { ok: false, reason: "invalid_model" };

  // GEMINI_MODEL only chooses the first model; the rest of the chain always follows it.
  const models = [...new Set([primary, DEFAULT_GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS])];
  return { ok: true, config: { apiKey, models } };
}
