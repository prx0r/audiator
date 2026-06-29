import { NextRequest, NextResponse } from 'next/server';
import { synthesizeSpeech } from '@/lib/voice/tts';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = String(body.text ?? '').trim();
    if (!text) return NextResponse.json({ error: 'Missing text' }, { status: 400 });

    const audio = await synthesizeSpeech(text);

    return new NextResponse(audio, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'Content-Length': String(audio.byteLength),
      },
    });
  } catch (err: any) {
    console.error('[TTS] error:', err.message);
    return NextResponse.json({ error: 'TTS failed', detail: err.message }, { status: 502 });
  }
}
