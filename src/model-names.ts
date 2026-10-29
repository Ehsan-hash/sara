// Model names with a meaning of their own.

/**
 * Ollama Cloud models run on Ollama's servers, even when asked through a local Ollama daemon. A
 * daemon names them with a `:cloud` tag or a `-cloud` suffix on the tag ("glm-5.2:cloud",
 * "gpt-oss:120b-cloud"); a local model that merely contains "cloud" ("cloudy:7b",
 * "my-cloud-distill:8b") is not one. net-guard.ts keeps its own copy of this rule (the egress gate
 * imports nothing); test/model-names.test.ts pins both to the same answers.
 */
export const CLOUD_MODEL_NAME = /(:|-)cloud$/i;

/** Is this an Ollama Cloud model name? */
export const isCloudModelName = (model: string): boolean => CLOUD_MODEL_NAME.test(String(model ?? '').trim());
