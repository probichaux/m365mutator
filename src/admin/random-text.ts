// Random text for mail mutations: OpenRouter when a key is configured, GUID otherwise.

import { randomUUID } from 'node:crypto';
import { loadConfig } from './config-store.js';
import { logger } from '../logger/logger.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Prompts specified by the mod03-mail plan. */
export const SUBJECT_PROMPT =
  'Generate a one-sentence subject line in English related to software-as-a-service applications, airline travel, or the World Cup.';
export const BODY_PROMPT =
  'Generate a one-paragraph text summary of a randomly chosen Microsoft documentation page.';

/**
 * Generate text for `prompt`. If an OpenRouter API key is configured, ask the
 * configured model; on any failure — or with no key — fall back to a GUID so a
 * mutation run never blocks on the LLM being reachable.
 */
export async function generateText(prompt: string): Promise<string> {
  const { openRouterApiKey, openRouterModel } = loadConfig();
  if (openRouterApiKey) {
    try {
      return await callOpenRouter(openRouterApiKey, openRouterModel, prompt);
    } catch (err) {
      logger.warn(`[MAIL] OpenRouter generation failed, using GUID fallback: ${String(err)}`);
    }
  }
  return randomUUID();
}

async function callOpenRouter(apiKey: string, model: string, prompt: string): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter HTTP ${res.status}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('OpenRouter returned no content');
  }
  return text;
}
