import { SttResult, VoiceMetadata, DEFAULT_STT_MODEL, MAX_AUDIO_SIZE_BYTES } from './types';

function toOpenRouterAudioFormat(mimeType: string): 'webm' | 'wav' {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('webm') || normalized.includes('ogg')) return 'webm';
  return 'wav';
}

export async function transcribeAudio(
  audioBase64: string,
  mimeType: string,
  durationMs: number,
): Promise<{ result: SttResult; metadata: VoiceMetadata }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const model = process.env.VOICE_STT_MODEL || DEFAULT_STT_MODEL;

  const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input_audio: {
        data: audioBase64,
        format: toOpenRouterAudioFormat(mimeType),
      },
      language: 'en',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Transcription failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data.text ?? data.transcription ?? '';

  return {
    result: { text, provider: 'openrouter', model },
    metadata: {
      duration_ms: durationMs,
      mime_type: mimeType,
      stt_provider: 'openrouter',
      stt_model: model,
    },
  };
}

export function validateAudioSize(bytes: number): void {
  if (bytes > MAX_AUDIO_SIZE_BYTES) {
    throw new Error(`Audio file too large: ${bytes} bytes (max ${MAX_AUDIO_SIZE_BYTES})`);
  }
}
