export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface LlmClient {
  provider: string;
  model: string;
  /** Returns the model's text. Throws LlmError if the provider fails. */
  complete(messages: ChatMessage[], options?: { json?: boolean }): Promise<string>;
}

export class LlmError extends Error {}

/** A required setting is missing. */
export class LlmConfigError extends LlmError {}

type Env = Record<string, string | undefined>;

interface Connection {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  jsonMode: boolean;
  timeoutMs: number;
}

const OPENROUTER_DEFAULTS = { baseUrl: "https://openrouter.ai/api/v1", model: "google/gemini-2.5-flash-lite" };
const LOCAL_DEFAULTS = { baseUrl: "http://localhost:11434/v1" };

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new LlmConfigError(`${name} is not set`);
  return value;
}

export function openRouterClient(env: Env = process.env): LlmClient {
  return connect({
    provider: "openrouter",
    baseUrl: env.OPENROUTER_BASE_URL ?? OPENROUTER_DEFAULTS.baseUrl,
    model: env.OPENROUTER_MODEL ?? OPENROUTER_DEFAULTS.model,
    apiKey: required(env, "OPENROUTER_API_KEY"),
    jsonMode: true,
    timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 30_000),
  });
}

/** Any server with an OpenAI-style API: Ollama (the default URL), llama.cpp, LM Studio or vLLM. */
export function localClient(env: Env = process.env): LlmClient {
  return connect({
    provider: "local",
    baseUrl: env.LOCAL_LLM_BASE_URL ?? LOCAL_DEFAULTS.baseUrl,
    model: required(env, "LOCAL_LLM_MODEL"),
    apiKey: env.LOCAL_LLM_API_KEY,
    jsonMode: env.LOCAL_LLM_JSON_MODE !== "false",
    timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 120_000),
  });
}

const PROVIDERS: Record<string, (env: Env) => LlmClient> = { openrouter: openRouterClient, local: localClient };

/** LLM_PROVIDER picks the provider at startup. */
export function createLlmClient(env: Env = process.env): LlmClient {
  const name = env.LLM_PROVIDER ?? "openrouter";
  const create = PROVIDERS[name];
  if (!create) throw new LlmConfigError(`LLM_PROVIDER must be one of ${Object.keys(PROVIDERS).join(", ")}, got "${name}"`);
  return create(env);
}

function connect({ provider, baseUrl, model, apiKey, jsonMode, timeoutMs }: Connection): LlmClient {
  return {
    provider,
    model,
    async complete(messages, options = {}) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0,
            ...(options.json && jsonMode ? { response_format: { type: "json_object" } } : {}),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new LlmError(`${provider} request failed: ${String(error)}`);
      }
      const body = (await response.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } } | null;
      if (!response.ok || body?.error) {
        throw new LlmError(`${provider} returned ${response.status}: ${body?.error?.message ?? "no details"}`);
      }
      const text = body?.choices?.[0]?.message?.content;
      if (!text) throw new LlmError(`${provider} returned an empty reply`);
      return text;
    },
  };
}
