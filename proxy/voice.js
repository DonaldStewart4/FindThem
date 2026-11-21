// proxy/voice.js: the optional "voice bot" parts of the proxy.
//
//   Deepgram   (speech → text): the person's recording becomes the report text.
//   ElevenLabs (text → speech): the app reads back what it filled in. ENGLISH ONLY.
//
// Both are OPTIONAL. Their keys are environment variables of the Worker (secrets, never in
// the website or the repo):
//   DEEPGRAM_API_KEY     set with: npx wrangler secret put DEEPGRAM_API_KEY
//   ELEVENLABS_API_KEY   set with: npx wrangler secret put ELEVENLABS_API_KEY
//   ELEVENLABS_VOICE_ID  optional plain variable in wrangler.toml (a default voice is used otherwise)
// If a key is missing, GET /voice says so and the app keeps using the phone's own speech
// recognition and doesn't speak, exactly as before these were added.

export const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';
export const DEEPGRAM_MODEL = 'nova-3'; // covers en, es, fr, zh, ja
export const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech/';
export const ELEVENLABS_MODEL = 'eleven_flash_v2_5'; // fast and cheap (used for English only, see SPEAK_LANGS)
export const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'; // a premade voice from ElevenLabs' docs
export const ELEVENLABS_FORMAT = 'mp3_22050_32'; // small MP3: fine for speech, quick on cell data

export const MAX_AUDIO_BYTES = 3 * 1024 * 1024; // about 1–3 minutes of compressed speech
export const MAX_SPEAK_CHARS = 500;             // the read-back is a few short sentences

// App language → Deepgram language code.
const DEEPGRAM_LANGS = { en: 'en', es: 'es', fr: 'fr', zh: 'zh-CN', ja: 'ja' };
// The read-back is English only (BenStew's decision): other languages get no ElevenLabs
// speech at all, and the app just shows the filled-in form, as it does without a key.
export const SPEAK_LANGS = ['en'];

// What the app can use, without revealing the keys: { listen: bool, speak: bool }.
export function voiceCapabilities(env) {
  return { listen: Boolean(env.DEEPGRAM_API_KEY), speak: Boolean(env.ELEVENLABS_API_KEY) };
}

// Builds the Deepgram request for a recording in `lang`. Returns { url, init } for fetch().
export function buildDeepgramRequest(env, audio, contentType, lang) {
  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    language: DEEPGRAM_LANGS[lang] || 'en',
    smart_format: 'true', // punctuation and numbers as digits ("10 minutes")
  });
  return {
    url: `${DEEPGRAM_URL}?${params}`,
    init: {
      method: 'POST',
      headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}`, 'Content-Type': contentType || 'audio/webm' },
      body: audio,
    },
  };
}

// Pulls the transcript out of Deepgram's answer ('' if there is none).
export function deepgramText(json) {
  const alt = json && json.results && json.results.channels && json.results.channels[0]
    && json.results.channels[0].alternatives && json.results.channels[0].alternatives[0];
  return alt && typeof alt.transcript === 'string' ? alt.transcript.trim() : '';
}

// Builds the ElevenLabs request to say `text` in `lang`. Returns { url, init } for fetch().
export function buildElevenLabsRequest(env, text, lang) {
  const voice = env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const body = {
    text: String(text).slice(0, MAX_SPEAK_CHARS),
    model_id: ELEVENLABS_MODEL,
    apply_text_normalization: 'on', // say "10" as "ten" (Flash doesn't do it by default)
  };
  if (SPEAK_LANGS.includes(lang)) body.language_code = lang;
  return {
    url: `${ELEVENLABS_URL}${encodeURIComponent(voice)}?output_format=${ELEVENLABS_FORMAT}`,
    init: {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify(body),
    },
  };
}
