import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDb, initTables } from '@/lib/db';
import { saveRecording, getRecordingStream, deleteRecording, getMp3Path } from '@/lib/audio/recorder';
import { analyzeWavFile, analyzeAudio } from '@/lib/audio/analyzer';
import { runDiarization, diarizationAvailable } from '@/lib/audio/diarizer';
import { buildTurnTimeline } from '@/lib/audio/turns';
import { getSessionEvents } from '@/lib/events/eventLog';
import { assessCall } from '@/lib/mvp/analysis/call-assessment';
import { extractOpenSmileFeatures, wavFromRecording } from '@/lib/audio/opensmile';

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

    const mp3Path = getMp3Path(sessionId, recording.id);
    await new Promise<void>((resolve) => {
      const ff = spawn('ffmpeg', [
        '-y', '-i', recording.filePath,
        '-codec:a', 'libmp3lame', '-b:a', '64k',
        '-ar', '22050', '-ac', '1',
        mp3Path,
      ]);
      const errChunks: Buffer[] = [];
      if (ff.stderr) ff.stderr.on('data', (d: Buffer) => errChunks.push(d));
      ff.on('close', (code) => {
        if (code !== 0) {
          const stderr = Buffer.concat(errChunks).toString();
          console.warn('[MP3] ffmpeg failed:', stderr.slice(-400));
        }
        resolve();
      });
      ff.on('error', (e) => { console.warn('[MP3] spawn error:', e.message); resolve(); });
    });

    const wavPath = await wavFromRecording(recording.filePath);
    const analysis = wavPath
      ? await analyzeWavFile(wavPath)
      : await analyzeAudio(audioBytes);

    let opensmileFeatures = null;
    try {
      if (wavPath) {
        opensmileFeatures = await extractOpenSmileFeatures(wavPath);
      }
    } catch (err) {
      console.warn('[Recording] openSMILE failed (non-fatal):', err);
    }

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

    const combined: Record<string, unknown> = { ...analysis, diarization, turnTimeline, opensmile: opensmileFeatures };

    let assessment = null;
    try {
      const events = getSessionEvents(sessionId);
      const routeEvents = events
        .filter(e => e.payload_json?.routeEvent)
        .map(e => (e.payload_json as any).routeEvent)
        .filter(Boolean);
      const transcript = events
        .filter(e => e.event_type === 'customer_message' || e.event_type === 'candidate_message')
        .map(e => ({ role: e.actor === 'customer' ? 'customer' : 'candidate', text: e.text || '' }));

      const voiceFeatures: Record<string, number | null> = {};
      if (opensmileFeatures?.features) {
        const f = opensmileFeatures.features;
        voiceFeatures.f0Mean = f.F0semitoneFrom27_5Hz_sma3nz_amean ?? null;
        voiceFeatures.f0Stddev = f.F0semitoneFrom27_5Hz_sma3nz_stddevNorm ?? null;
        const pctl20 = f.F0semitoneFrom27_5Hz_sma3nz_percentile20_0 ?? null;
        const pctl80 = f.F0semitoneFrom27_5Hz_sma3nz_percentile80_0 ?? null;
        voiceFeatures.f0Range = (pctl80 != null && pctl20 != null) ? pctl80 - pctl20 : null;
        voiceFeatures.loudnessMean = f.loudness_sma3_amean ?? null;
        voiceFeatures.jitter = f.jitterLocal_sma3nz_amean ?? null;
        voiceFeatures.shimmer = f.shimmerLocaldB_sma3nz_amean ?? null;
        voiceFeatures.hnr = f.HNRdBACF_sma3nz_amean ?? null;
        voiceFeatures.spectralFlux = f.spectralFlux_sma3_amean ?? null;
        voiceFeatures.speechRate = f.loudnessPeaksPerSec ?? null;
      }

      assessment = await assessCall({
        sessionId,
        transcript,
        routeEvents,
        acousticAnalysis: {
          durationMs: analysis.durationMs,
          talkRatio: analysis.talkRatio,
          silenceRatio: analysis.silenceRatio,
          longestSilenceMs: analysis.longestSilenceMs,
          silenceSegments: analysis.silenceSegments,
          avgRms: analysis.avgRms,
          peakRms: analysis.peakRms,
          rmsVariance: analysis.rmsVariance,
        },
        voiceFeatures: Object.keys(voiceFeatures).length > 0 ? voiceFeatures as any : null,
      });
    } catch (err) {
      console.warn('[Recording] Assessment failed (non-fatal):', err);
    }

    combined.assessment = assessment;

    const db = getDb();
    db.prepare(`
      INSERT INTO recordings (id, session_id, file_path, duration_ms, analysis_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(recording.id, sessionId, recording.filePath, durationMs, JSON.stringify(combined));

    return NextResponse.json({
      id: recording.id,
      path: recording.filePath,
      mp3Path: mp3Path,
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
        opensmile: opensmileFeatures ? {
          numFeatures: opensmileFeatures.numFeatures,
          features: opensmileFeatures.features,
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
    const format = searchParams.get('format') || 'webm';

    if (!sessionId || !id) {
      return NextResponse.json({ error: 'Missing session_id or id' }, { status: 400 });
    }

    if (format === 'mp3') {
      const mp3Path = getMp3Path(sessionId, id);
      if (!fs.existsSync(mp3Path)) {
        return NextResponse.json({ error: 'MP3 not found' }, { status: 404 });
      }
      const stream = fs.createReadStream(mp3Path);
      return new NextResponse(stream as any, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Disposition': `inline; filename="call-${sessionId}.mp3"`,
        },
      });
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
