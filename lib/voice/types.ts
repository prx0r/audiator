export interface VoiceMetadata {
  duration_ms: number;
  mime_type: string;
  stt_provider: string;
  stt_model: string;
}

export interface SttResult {
  text: string;
  provider: string;
  model: string;
}

export type InputSource = 'text' | 'voice';

export const DEFAULT_TTS_MODEL = 'hexgrad/kokoro-82m';
export const DEFAULT_STT_MODEL = 'openai/whisper-large-v3-turbo';
export const DEFAULT_TTS_VOICE = 'af_heart';
export const MAX_AUDIO_SIZE_BYTES = 8 * 1024 * 1024;
export const MAX_TTS_TEXT_LENGTH = 1000;
