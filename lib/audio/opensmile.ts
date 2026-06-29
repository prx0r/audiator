import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface OpenSmileFeatures {
  numFeatures?: number;
  features?: Record<string, number | null>;
  error?: string;
}

const SCRIPTS_DIR = path.resolve(process.cwd(), 'scripts');

export async function extractOpenSmileFeatures(
  audioFilePath: string,
): Promise<OpenSmileFeatures> {
  return new Promise((resolve) => {
    const proc = spawn('python3', [
      path.join(SCRIPTS_DIR, 'extract-egemaps.py'),
      audioFilePath,
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0 || !stdout) {
        resolve({ error: `openSMILE exited code ${code}: ${stderr.slice(0, 200)}` });
        return;
      }
      try {
        const parsed: OpenSmileFeatures = JSON.parse(stdout);
        resolve(parsed);
      } catch {
        resolve({ error: `Failed to parse openSMILE output: ${stdout.slice(0, 200)}` });
      }
    });

    proc.on('error', (err) => {
      resolve({ error: err.message });
    });
  });
}

export function opensmileAvailable(): boolean {
  try {
    spawn('python3', ['-c', 'import opensmile; print("ok")']);
    return true;
  } catch {
    return false;
  }
}

export async function wavFromRecording(
  recordingPath: string,
): Promise<string | null> {
  const wavPath = recordingPath.replace(/\.\w+$/, '.wav');
  if (fs.existsSync(wavPath)) return wavPath;

  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', [
      '-y', '-i', recordingPath,
      '-ar', '16000', '-ac', '1', '-sample_fmt', 's16',
      wavPath,
    ]);
    ff.on('close', (code) => resolve(code === 0 ? wavPath : null));
    ff.on('error', () => resolve(null));
  });
}
