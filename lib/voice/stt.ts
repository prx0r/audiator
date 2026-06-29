import { MAX_AUDIO_SIZE_BYTES } from './types.ts';
import type { SttResult, VoiceMetadata, SttProviderName } from './types.ts';

function providerName(): SttProviderName {
  return (process.env.VOICE_STT_PROVIDER as SttProviderName | undefined) ?? 'fixture';
}

function toOpenRouterAudioFormat(mimeType: string): 'webm' | 'wav' {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('webm') || normalized.includes('ogg')) return 'webm';
  return 'wav';
}

async function transcribeWithFixture(audioBase64: string): Promise<SttResult> {
  const decoded = Buffer.from(audioBase64, 'base64').toString('utf8').trim();
  return { text: decoded || process.env.FIXTURE_STT_TEXT || '', provider: 'fixture', model: 'text-fixture' };
}

async function transcribeWithVosk(audioBase64: string, mimeType: string): Promise<SttResult> {
  const baseUrl = process.env.VOSK_BASE_URL || 'http://127.0.0.1:2700';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64, mimeType, language: 'en' }),
  });
  if (!response.ok) throw new Error(`Vosk transcription failed (${response.status}): ${await response.text()}`);
  const data = await response.json();
  return { text: data.text ?? data.transcript ?? '', provider: 'vosk', model: data.model ?? 'vosk-local' };
}

async function transcribeWithWhisperCpp(audioBase64: string, mimeType: string): Promise<SttResult> {
  const baseUrl = process.env.WHISPER_CPP_BASE_URL;
  if (!baseUrl) throw new Error('WHISPER_CPP_BASE_URL not configured');
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64, mimeType, language: 'en' }),
  });
  if (!response.ok) throw new Error(`whisper.cpp transcription failed (${response.status}): ${await response.text()}`);
  const data = await response.json();
  return { text: data.text ?? data.transcript ?? '', provider: 'whisper_cpp', model: data.model ?? 'whisper.cpp' };
}

async function transcribeWithOpenRouter(audioBase64: string, mimeType: string): Promise<SttResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');
  const model = process.env.VOICE_STT_MODEL || 'openai/whisper-large-v3-turbo';
  const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input_audio: { data: audioBase64, format: toOpenRouterAudioFormat(mimeType) }, language: 'en' }),
  });
  if (!response.ok) throw new Error(`Transcription failed (${response.status}): ${await response.text()}`);
  const data = await response.json();
  return { text: data.text ?? data.transcription ?? '', provider: 'openrouter', model };
}

export async function transcribeAudio(audioBase64: string, mimeType: string, durationMs: number): Promise<{ result: SttResult; metadata: VoiceMetadata }> {
  const provider = providerName();
  let result: SttResult;
  if (provider === 'fixture') result = await transcribeWithFixture(audioBase64);
  else if (provider === 'vosk') result = await transcribeWithVosk(audioBase64, mimeType);
  else if (provider === 'whisper_cpp') result = await transcribeWithWhisperCpp(audioBase64, mimeType);
  else if (provider === 'openrouter') result = await transcribeWithOpenRouter(audioBase64, mimeType);
  else if (provider === 'sherpa') throw new Error('sherpa STT provider requires the benchmark adapter before API use');
  else throw new Error(`Unsupported STT provider: ${provider}`);

  return {
    result,
    metadata: { duration_ms: durationMs, mime_type: mimeType, stt_provider: result.provider, stt_model: result.model },
  };
}

export function validateAudioSize(bytes: number): void {
  if (bytes > MAX_AUDIO_SIZE_BYTES) throw new Error(`Audio file too large: ${bytes} bytes (max ${MAX_AUDIO_SIZE_BYTES})`);
}
