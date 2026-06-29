import { NextRequest, NextResponse } from 'next/server';
import { getDb, initTables } from '@/lib/db';
import { saveRecording, getRecordingStream, deleteRecording } from '@/lib/audio/recorder';
import { analyzeAudio } from '@/lib/audio/analyzer';
import { runDiarization, diarizationAvailable } from '@/lib/audio/diarizer';
import { buildTurnTimeline } from '@/lib/audio/turns';

const MAX_RECORDING_SIZE = 50 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    initTables();
    const form = await req.formData();
    const file = form.get('audio');
    const sessionId = form.get('session_id') as string | null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing audio file' }, { status: 400 });
    }

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
    }

    if (file.size > MAX_RECORDING_SIZE) {
      return NextResponse.json(
        { error: `Recording too large: ${file.size} bytes (max ${MAX_RECORDING_SIZE})` },
        { status: 413 },
      );
    }

    const durationMs = (() => {
      const raw = form.get('duration_ms');
      if (raw) return parseInt(String(raw), 10) || 0;
      return 0;
    })();

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const recording = saveRecording(buffer, sessionId, durationMs);

    const audioBytes = new Uint8Array(arrayBuffer);

    const analysis = await analyzeAudio(audioBytes);

    let diarization = null;
    if (diarizationAvailable()) {
      try {
        diarization = await runDiarization(audioBytes, 16000);
      } catch (err) {
        console.warn('[Recording] Diarization failed (non-fatal):', err);
      }
    }

    let turnTimeline = null;
    try {
      turnTimeline = buildTurnTimeline(sessionId);
    } catch (err) {
      console.warn('[Recording] Turn timeline failed (non-fatal):', err);
    }

    const combined = { ...analysis, diarization, turnTimeline };

    const db = getDb();
    db.prepare(`
      INSERT INTO recordings (id, session_id, file_path, duration_ms, analysis_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(recording.id, sessionId, recording.filePath, durationMs, JSON.stringify(combined));

    return NextResponse.json({
      id: recording.id,
      path: recording.filePath,
      sizeBytes: recording.sizeBytes,
      analysis: {
        durationMs: analysis.durationMs,
        silenceRatio: analysis.silenceRatio,
        talkRatio: analysis.talkRatio,
        longestSilenceMs: analysis.longestSilenceMs,
        silenceSegments: analysis.silenceSegments,
        diarization: diarization ? {
          numSpeakers: diarization.numSpeakers,
          speakerLabels: diarization.speakerLabels,
          perSpeakerMetrics: diarization.perSpeakerMetrics,
        } : null,
      },
    });
  } catch (err: any) {
    console.error('[Recording] Upload error:', err.message);
    return NextResponse.json(
      { error: 'Recording upload failed', detail: err.message },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('session_id');
    const id = searchParams.get('id');

    if (!sessionId || !id) {
      return NextResponse.json({ error: 'Missing session_id or id' }, { status: 400 });
    }

    const stream = getRecordingStream(sessionId, id);
    if (!stream) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    return new NextResponse(stream as any, {
      headers: {
        'Content-Type': 'audio/webm',
        'Content-Disposition': `inline; filename="call-${sessionId}.webm"`,
      },
    });
  } catch (err: any) {
    console.error('[Recording] Get error:', err.message);
    return NextResponse.json({ error: 'Failed to retrieve recording' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('session_id');
    const id = searchParams.get('id');

    if (!sessionId || !id) {
      return NextResponse.json({ error: 'Missing session_id or id' }, { status: 400 });
    }

    const deleted = deleteRecording(sessionId, id);

    const db = getDb();
    db.prepare('DELETE FROM recordings WHERE id = ? AND session_id = ?').run(id, sessionId);

    return NextResponse.json({ deleted });
  } catch (err: any) {
    console.error('[Recording] Delete error:', err.message);
    return NextResponse.json({ error: 'Failed to delete recording' }, { status: 500 });
  }
}
