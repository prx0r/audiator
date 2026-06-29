import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const RECORDINGS_DIR = path.resolve(process.cwd(), 'data', 'recordings');

export interface RecordingInfo {
  id: string;
  sessionId: string;
  filePath: string;
  fileName: string;
  durationMs: number;
  sizeBytes: number;
  createdAt: string;
}

function ensureDir(): void {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

export function generateRecordingId(): string {
  return crypto.randomUUID();
}

export function getRecordingPath(sessionId: string, id: string): string {
  return path.join(RECORDINGS_DIR, `${sessionId}-${id}.webm`);
}

export function saveRecording(
  audioBuffer: Buffer,
  sessionId: string,
  durationMs: number,
): RecordingInfo {
  ensureDir();
  const id = generateRecordingId();
  const filePath = getRecordingPath(sessionId, id);
  const fileName = path.basename(filePath);

  fs.writeFileSync(filePath, audioBuffer);

  return {
    id,
    sessionId,
    filePath,
    fileName,
    durationMs,
    sizeBytes: audioBuffer.length,
    createdAt: new Date().toISOString(),
  };
}

export function getRecordingStream(sessionId: string, id: string): fs.ReadStream | null {
  const filePath = getRecordingPath(sessionId, id);
  if (!fs.existsSync(filePath)) return null;
  return fs.createReadStream(filePath);
}

export function recordingExists(sessionId: string, id: string): boolean {
  return fs.existsSync(getRecordingPath(sessionId, id));
}

export function deleteRecording(sessionId: string, id: string): boolean {
  const filePath = getRecordingPath(sessionId, id);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

export function listRecordings(sessionId: string): RecordingInfo[] {
  ensureDir();
  const prefix = `${sessionId}-`;
  const files = fs.readdirSync(RECORDINGS_DIR).filter(f => f.startsWith(prefix));
  return files.map(f => {
    const stat = fs.statSync(path.join(RECORDINGS_DIR, f));
    const id = f.replace(prefix, '').replace('.webm', '');
    return {
      id,
      sessionId,
      filePath: path.join(RECORDINGS_DIR, f),
      fileName: f,
      durationMs: 0,
      sizeBytes: stat.size,
      createdAt: stat.birthtime.toISOString(),
    };
  });
}
