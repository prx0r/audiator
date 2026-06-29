import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { synthesizeSpeech } from '../lib/voice/tts.ts';

describe('fixture TTS cache', () => {
  it('returns fixture audio without an external provider', async () => {
    process.env.VOICE_TTS_PROVIDER = 'fixture';
    process.env.CALLCALLUM_AUDIO_CACHE_DIR = '/tmp/audiator-test-tts-cache';
    const audio = await synthesizeSpeech('hello');
    assert.ok(audio.byteLength > 44);
    assert.ok(fs.existsSync('/tmp/audiator-test-tts-cache'));
    fs.rmSync('/tmp/audiator-test-tts-cache', { recursive: true, force: true });
  });
});
