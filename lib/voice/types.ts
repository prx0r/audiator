export type SttProviderName = 'fixture' | 'vosk' | 'sherpa' | 'whisper_cpp' | 'openrouter';
export type TtsProviderName = 'fixture' | 'kokoro' | 'openrouter';

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

export const DEFAULT_TTS_MODEL = 'kokoro';
export const DEFAULT_STT_MODEL = 'vosk-local';
export const DEFAULT_TTS_VOICE = 'af_heart';
export const MAX_AUDIO_SIZE_BYTES = 8 * 1024 * 1024;
export const MAX_TTS_TEXT_LENGTH = 1000;
