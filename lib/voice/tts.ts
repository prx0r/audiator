import { DEFAULT_TTS_VOICE, MAX_TTS_TEXT_LENGTH } from './types';

export async function synthesizeSpeech(
  text: string,
  voice?: string,
): Promise<ArrayBuffer> {
  if (!text.trim()) throw new Error('Text is required for TTS');
  if (text.length > MAX_TTS_TEXT_LENGTH) throw new Error(`Text too long: ${text.length} chars (max ${MAX_TTS_TEXT_LENGTH})`);

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) throw new Error('No TTS provider configured. Set OPENROUTER_API_KEY.');

  const model = process.env.VOICE_TTS_MODEL || 'hexgrad/kokoro-82m';
  const ttsVoice = voice || process.env.VOICE_TTS_VOICE || DEFAULT_TTS_VOICE;

  const response = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openRouterKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: text,
      voice: ttsVoice,
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter TTS failed (${response.status}): ${errorText}`);
  }

  return response.arrayBuffer();
}
