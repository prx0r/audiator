import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DEFAULT_TTS_VOICE, MAX_TTS_TEXT_LENGTH } from './types.ts';
import type { TtsProviderName } from './types.ts';

function providerName(): TtsProviderName {
  return (process.env.VOICE_TTS_PROVIDER as TtsProviderName | undefined) ?? 'fixture';
}

function cacheDir(): string {
  return path.resolve(process.cwd(), process.env.CALLCALLUM_AUDIO_CACHE_DIR || './data/tts-cache');
}

function cachePath(text: string, voice: string, format: string): string {
  const hash = crypto.createHash('sha1').update(`${voice}\n${format}\n${text}`).digest('hex');
  return path.join(cacheDir(), `${voice}-${hash}.${format}`);
}

function wavSilence(durationMs = 180): Buffer {
  const sampleRate = 16000;
  const samples = Math.floor(sampleRate * durationMs / 1000);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;
  const write = (s: string) => { buffer.write(s, offset); offset += s.length; };
  const u16 = (n: number) => { offset = buffer.writeUInt16LE(n, offset); };
  const u32 = (n: number) => { offset = buffer.writeUInt32LE(n, offset); };
  write('RIFF'); u32(36 + dataSize); write('WAVE'); write('fmt '); u32(16); u16(1); u16(1); u32(sampleRate); u32(sampleRate * 2); u16(2); u16(16); write('data'); u32(dataSize);
  return buffer;
}

async function synthesizeWithKokoro(text: string, voice: string): Promise<Buffer> {
  const baseUrl = process.env.KOKORO_BASE_URL || 'http://127.0.0.1:8880';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.VOICE_TTS_MODEL || 'kokoro', input: text, voice, response_format: 'mp3' }),
  });
  if (!response.ok) throw new Error(`Kokoro TTS failed (${response.status}): ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

async function synthesizeWithOpenRouter(text: string, voice: string): Promise<Buffer> {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) throw new Error('OPENROUTER_API_KEY not configured');
  const response = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openRouterKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.VOICE_TTS_MODEL || 'hexgrad/kokoro-82m', input: text, voice, response_format: 'mp3' }),
  });
  if (!response.ok) throw new Error(`OpenRouter TTS failed (${response.status}): ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function synthesizeSpeech(text: string, voice?: string): Promise<ArrayBuffer> {
  if (!text.trim()) throw new Error('Text is required for TTS');
  if (text.length > MAX_TTS_TEXT_LENGTH) throw new Error(`Text too long: ${text.length} chars (max ${MAX_TTS_TEXT_LENGTH})`);

  const ttsVoice = voice || process.env.VOICE_TTS_VOICE || DEFAULT_TTS_VOICE;
  const provider = providerName();
  const format = provider === 'fixture' ? 'wav' : 'mp3';
  const filePath = cachePath(text, ttsVoice, format);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) return fs.readFileSync(filePath).buffer.slice(0) as ArrayBuffer;

  let audio: Buffer;
  if (provider === 'fixture') audio = wavSilence();
  else if (provider === 'kokoro') audio = await synthesizeWithKokoro(text, ttsVoice);
  else if (provider === 'openrouter') audio = await synthesizeWithOpenRouter(text, ttsVoice);
  else throw new Error(`Unsupported TTS provider: ${provider}`);

  fs.writeFileSync(filePath, audio);
  return audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
}
