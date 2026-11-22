// proxy/say.js — POST /say: one short, calm reply, worded by a text LLM but held to the facts.
//
// The request is only { intent, data, lang }. The LLM is told the fixed template's meaning and the
// facts, and asked to say it in its own calm words. Its reply goes through replies.js checkReply();
// anything that fails (or no key, a slow or broken provider, a refusal) gives the fixed template.
// 'emergency' and 'found' never reach the LLM. See docs/REPLIES.md.
//
// Provider-agnostic: the Worker secret LLM_API_KEY, plus in wrangler.toml [vars]
//   LLM_PROVIDER  "anthropic" (default) or "openai-compatible" (any /chat/completions API)
//   LLM_MODEL     the model id (default "claude-opus-5-5" for anthropic)
//   LLM_BASE_URL  optional: another endpoint (needed for openai-compatible providers other than OpenAI)
// No SDK: plain fetch, like the rest of the proxy. This file has no Cloudflare code, so tests run it.

import { INTENTS, FIXED_INTENTS, LANGS, cleanSayData, templateReply, warningLines, replyFacts, checkReply } from '../replies.js';

export const LLM_TIMEOUT_MS = 4000;     // the phone waits 2.5 s; a slower reply is dropped anyway
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2026-10-21';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
export const PROVIDERS = ['anthropic', 'openai-compatible'];
const LANG_NAMES = { en: 'English', es: 'Spanish', fr: 'French', zh: 'Simplified Chinese', ja: 'Japanese' };
// Anthropic models that take the server-side refusal fallback (a refusal is otherwise a template).
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|fable-5-[12]|sonnet-5-5)$/;

// The instructions and the one message for the LLM.
export function buildPrompt(intent, data, lang) {
  const system = [
    'You word one reply for a phone app used in the first hour of a search for a missing person with dementia.',
    'The person reading is frightened. Be calm, kind and plain.',
    `Write ONE line in ${LANG_NAMES[lang]}, at most two short sentences, no lists, no markup, no quotes.`,
    'Say what MEANING says, in your own words. Use only the facts in FACTS.',
    'Never add a place, a street, a number, a time, a distance or a direction that is not in FACTS.',
    'Never say where the missing person is or might be. Never promise or reassure that they will be found or are safe.',
    'Never give medical advice. Never mention water, roads, traffic, or anyone\'s house or yard unless MEANING does.',
    'Never mention that you are a bot or an AI.',
    'Reply with the sentence only.',
  ].join('\n');
  const user = JSON.stringify({ MEANING: templateReply(intent, data, lang), FACTS: replyFacts(intent, data, lang) });
  return { system, user };
}

// The HTTP request for the configured provider: { url, init } (no secret in the URL).
export function buildLLMRequest(env, prompt) {
  const provider = env.LLM_PROVIDER || 'anthropic';
  if (provider === 'anthropic') {
    const model = env.LLM_MODEL || DEFAULT_ANTHROPIC_MODEL;
    const headers = { 'Content-Type': 'application/json', 'x-api-key': env.LLM_API_KEY, 'anthropic-version': ANTHROPIC_VERSION };
    const body = {
      model,
      max_tokens: 2048,                    // thinking counts toward it on current models; the reply itself is short
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      output_config: { effort: 'low' },     // a short wording task
    };
    if (FALLBACK_MODELS.test(model)) {
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';           // a policy decline is retried on another model by the API
    }
    return { url: env.LLM_BASE_URL || ANTHROPIC_URL, init: { method: 'POST', headers, body: JSON.stringify(body) } };
  }
  if (provider === 'openai-compatible') {
    const base = (env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    return {
      url: `${base}/chat/completions`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LLM_API_KEY}` },
        body: JSON.stringify({
          model: env.LLM_MODEL,
          max_tokens: 200,
          messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
        }),
      },
    };
  }
  return null;
}

// The reply text from a provider's JSON, or null (a refusal, a cut-off reply, or an odd shape).
export function replyText(provider, json) {
  if (!json || typeof json !== 'object') return null;
  if ((provider || 'anthropic') === 'anthropic') {
    if (json.stop_reason !== 'end_turn' || !Array.isArray(json.content)) return null;
    const text = json.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('').trim();
    return text || null;
  }
  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  if (!choice || choice.finish_reason === 'length' || !choice.message || typeof choice.message.content !== 'string') return null;
  return choice.message.content.trim() || null;
}

// Handles one POST /say body → { status, body }. body = { text, source: 'llm' | 'template', warnings, why? }.
export async function say(env, request, fetchFn = globalThis.fetch) {
  // Only { intent, data, lang }.
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).some((k) => !['intent', 'data', 'lang'].includes(k))) return { status: 400, body: { error: 'bad_request' } };
  const { intent } = request;
  const lang = LANGS.includes(request.lang) ? request.lang : null;
  if (!INTENTS.includes(intent) || !lang) return { status: 400, body: { error: 'bad_request' } };
  const data = cleanSayData(intent, request.data);
  if (!data) return { status: 400, body: { error: 'bad_data' } };

  const warnings = warningLines(intent, data, lang);
  const template = (why) => ({ status: 200, body: { text: templateReply(intent, data, lang), source: 'template', warnings, why } });
  if (FIXED_INTENTS.includes(intent)) return template('fixed');
  if (!env.LLM_API_KEY) return template('no_key');
  const provider = env.LLM_PROVIDER || 'anthropic';
  const req = PROVIDERS.includes(provider) ? buildLLMRequest(env, buildPrompt(intent, data, lang)) : null;
  if (!req || (provider === 'openai-compatible' && !env.LLM_MODEL)) return template('bad_provider');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  let json;
  try {
    const res = await fetchFn(req.url, { ...req.init, signal: controller.signal });
    if (!res.ok) return template('upstream');
    json = await res.json();
  } catch (err) {
    return template('upstream');
  } finally {
    clearTimeout(timer);
  }
  let text = replyText(provider, json);
  if (!text) return template('no_text');
  text = text.replace(/^["'“”«»「」]+|["'“”«»「」]+$/g, '').trim(); // a wrapping pair of quotes is harmless
  const check = checkReply(text, { intent, data, lang });
  if (!check.ok) return template(`rejected_${check.why}`);
  return { status: 200, body: { text, source: 'llm', warnings } };
}
