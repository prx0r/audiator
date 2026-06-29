import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudio, validateAudioSize } from '@/lib/voice/stt';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('audio');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing audio file' }, { status: 400 });
    }

    validateAudioSize(file.size);

    const arrayBuffer = await file.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');

    const durationMs = (() => {
      const raw = form.get('duration_ms');
      if (raw) return parseInt(String(raw), 10) || 0;
      return 0;
    })();

    const { result, metadata } = await transcribeAudio(
      base64Audio,
      file.type || 'audio/webm',
      durationMs,
    );

    return NextResponse.json({
      text: result.text,
      provider: result.provider,
      model: result.model,
      metadata,
    });
  } catch (err: any) {
    console.error('[STT] Transcribe error:', err.message);

    if (err.message?.includes('too large')) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }

    return NextResponse.json(
      { error: 'Transcription failed', detail: err.message },
      { status: 502 },
    );
  }
}
