'use client';

import { useRef, useState, useEffect } from 'react';

export type VoiceTranscriptResult = {
  text: string;
  durationMs: number;
  mimeType: string;
};

type Props = {
  sessionId: string;
  onTranscript: (result: VoiceTranscriptResult) => Promise<void>;
  disabled?: boolean;
  autoRecordTrigger?: number;
  onRecordingStarted?: (startedAtMs: number) => void;
};

function chooseRecorderMimeType(): string | undefined {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/webm',
    'audio/ogg',
  ];
  return candidates.find(type => MediaRecorder.isTypeSupported(type));
}

function audioExtension(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

export function VoiceRecorderButton({
  sessionId, onTranscript, disabled, autoRecordTrigger,
  onRecordingStarted,
}: Props) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const autoTriggerRef = useRef<number>(0);

  useEffect(() => {
    if (autoRecordTrigger !== undefined && autoRecordTrigger > autoTriggerRef.current) {
      autoTriggerRef.current = autoRecordTrigger;
      if (!disabled && !recording) startRecording();
    }
  }, [autoRecordTrigger, disabled, recording]);

  useEffect(() => {
    return () => {
      recorderRef.current?.stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  async function startRecording() {
    try {
      setError('');

      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Microphone is not available');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });

      chunksRef.current = [];
      startTimeRef.current = Date.now();
      onRecordingStarted?.(startTimeRef.current);

      const requestedMimeType = chooseRecorderMimeType();
      const recorder = requestedMimeType
        ? new MediaRecorder(stream, { mimeType: requestedMimeType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());

        if (chunksRef.current.length === 0) return;

        const durationMs = Date.now() - startTimeRef.current;
        const mimeType = recorder.mimeType || requestedMimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });

        const formData = new FormData();
        formData.append('audio', blob, `candidate.${audioExtension(mimeType)}`);
        formData.append('duration_ms', String(durationMs));

        try {
          const res = await fetch('/api/stt', { method: 'POST', body: formData });
          if (!res.ok) {
            const err = await res.json();
            setError(err.error || 'Transcription failed');
            return;
          }
          const data = await res.json();
          if (data.text?.trim()) {
            await onTranscript({ text: data.text.trim(), durationMs, mimeType });
          }
        } catch {
          setError('Failed to send audio');
        }
      };

      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err: any) {
      if (err.name === 'NotAllowedError') setError('Microphone permission denied');
      else if (err.name === 'NotFoundError') setError('No microphone found');
      else setError('Could not start recording');
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setRecording(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onTouchStart={startRecording}
          onTouchEnd={stopRecording}
          disabled={disabled}
          className={`
            select-none rounded px-5 py-2.5 text-sm font-medium transition-all
            ${recording
              ? 'bg-red-600 text-white ring-2 ring-red-400 animate-pulse'
              : 'bg-blue-600 text-white hover:bg-blue-700'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          {recording ? 'Release to send' : 'Hold to talk'}
        </button>
        {recording && (
          <span className="flex items-center gap-1.5 text-sm text-red-400">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
            Recording...
          </span>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
