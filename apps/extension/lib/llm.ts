import { LLM_SYSTEM_PROMPT, LLM_TIMEOUT_MS, type LlmRequest } from '@smartfill/core';
import type { Settings } from '@smartfill/schemas';

type LlmSettings = Settings['llm'];

export const GROQ_BASE = 'https://api.groq.com';
export const GROQ_DEFAULT_MODEL = 'llama-3.3-70b-versatile';

/** Proxy endpoints must be HTTPS (localhost excepted for development). */
export function validateEndpoint(raw: string | undefined, provider: LlmSettings['provider']): URL {
  const url = new URL(raw || (provider === 'groq' ? GROQ_BASE : ''));
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !local) throw new Error('AI endpoint must use https (or localhost).');
  return url;
}

/** Host-permission pattern for an endpoint, e.g. `https://proxy.example.com/*`. */
export function originPattern(url: URL): string {
  return `${url.protocol}//${url.hostname}/*`;
}

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal,
      credentials: 'omit',
    });
    if (!res.ok) throw new Error(`LLM endpoint returned HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Returns the *untrusted* raw JSON; the caller validates it with `parseLlmResponse`. */
export async function callLlm(settings: LlmSettings, request: LlmRequest): Promise<unknown> {
  if (!settings.enabled || settings.provider === 'off') throw new Error('AI is off');
  const base = validateEndpoint(settings.endpoint, settings.provider);

  if (settings.provider === 'proxy') {
    const headers: Record<string, string> = settings.token ? { 'x-smartfill-token': settings.token } : {};
    return postJson(new URL('/map-fields', base).toString(), request, headers);
  }

  // Groq: OpenAI-compatible chat completions with JSON mode. Needs the user's own API key.
  if (!settings.token) throw new Error('Add your Groq API key in AI settings.');
  const res = (await postJson(new URL('/openai/v1/chat/completions', base).toString(), {
    model: settings.model || GROQ_DEFAULT_MODEL,
    temperature: 0,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: LLM_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(request) },
    ],
  }, { authorization: `Bearer ${settings.token}` })) as { choices?: { message?: { content?: string } }[] };
  return JSON.parse(res.choices?.[0]?.message?.content ?? 'null');
}
