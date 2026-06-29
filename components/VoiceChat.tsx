'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { VoiceTranscriptResult } from './VoiceRecorderButton';
import { useAudioPlayer } from './AudioPlayer';
import { useLiveKit } from '@/hooks/useLiveKit';

interface Message {
  role: 'customer' | 'candidate' | 'system';
  text: string;
  timestamp: number;
  decision?: any;
}

export function VoiceChat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [callActive, setCallActive] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [livekitMode, setLivekitMode] = useState(false);
  const [micError, setMicError] = useState('');
  const [isUtteranceActive, setIsUtteranceActive] = useState(false);
  const transcriptRef = useRef<string[]>([]);
  const navigationPendingRef = useRef(false);
  const continuousRecorderRef = useRef<MediaRecorder | null>(null);
  const utteranceRecorderRef = useRef<MediaRecorder | null>(null);
  const openingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callStartRef = useRef(0);
  const { speak, stop, setOnTtsEnd } = useAudioPlayer();
  const chatHistoryRef = useRef<Array<{ role: string; content: string }>>([]);
  const livekit = useLiveKit();

  const addMessage = useCallback((msg: Message) => {
    setMessages(prev => [...prev, msg]);
  }, []);

  const handleTranscript = useCallback(async (result: VoiceTranscriptResult) => {
    const text = result.text;
    addMessage({ role: 'candidate', text, timestamp: Date.now() });
    transcriptRef.current.push(`Candidate: ${text}`);

    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId,
          history: chatHistoryRef.current,
        }),
      });

      if (!res.ok) throw new Error('Chat failed');

      const data = await res.json();
      const reply = data.reply;

      chatHistoryRef.current.push({ role: 'user', content: text });
      chatHistoryRef.current.push({ role: 'assistant', content: reply });

      addMessage({ role: 'customer', text: reply, timestamp: Date.now(), decision: data.decision });
      transcriptRef.current.push(`Customer: ${reply}`);

      await speak(reply);
    } catch (err: any) {
      addMessage({ role: 'system', text: `Error: ${err.message}`, timestamp: Date.now() });
    } finally {
      setLoading(false);
    }
  }, [addMessage, speak, sessionId]);

  const sendUtteranceToStt = useCallback(async (blob: Blob, mimeType: string) => {
    const formData = new FormData();
    const durationMs = Date.now();
    formData.append('audio', blob, 'utterance.webm');
    formData.append('duration_ms', String(durationMs));

    try {
      const res = await fetch('/api/stt', { method: 'POST', body: formData });
      if (res.ok) {
        const data = await res.json();
        if (data.text?.trim()) {
          const result: VoiceTranscriptResult = { text: data.text.trim(), durationMs, mimeType };
          await handleTranscript(result);
        }
      } else {
        console.error('STT returned', res.status);
      }
    } catch (err) {
      console.error('STT failed:', err);
    }
  }, [handleTranscript]);

  const navigateToAnalysis = useCallback((sid: string) => {
    window.location.href = `/analysis/${sid}`;
  }, []);

  const startUtterance = useCallback(async () => {
    if (utteranceRecorderRef.current) return;
    setIsUtteranceActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      const mimeTypes = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/ogg'];
      const mimeType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      utteranceRecorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        utteranceRecorderRef.current = null;
        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
          sendUtteranceToStt(blob, recorder.mimeType || mimeType || 'audio/webm');
        }
      };
      recorder.start();
    } catch (err: any) {
      console.warn('Utterance mic failed:', err.message);
      setIsUtteranceActive(false);
    }
  }, [sendUtteranceToStt]);

  const stopUtterance = useCallback(() => {
    const recorder = utteranceRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    }
    setIsUtteranceActive(false);
  }, []);

  const startCall = useCallback(async () => {
    stop();
    if (openingTimeoutRef.current) clearTimeout(openingTimeoutRef.current);
    setMessages([]);
    setAnalysis(null);
    setMicError('');
    transcriptRef.current = [];
    chatHistoryRef.current = [];
    callStartRef.current = Date.now();

    try {
      let sid = sessionId;
      let useLiveKit = false;

      try {
        const lkData = await livekit.startCall();
        sid = lkData.sessionId;
        useLiveKit = true;
      } catch {
        const res = await fetch('/api/session', { method: 'POST' });
        const data = await res.json();
        sid = data.id;
      }

      setSessionId(sid);
      setLivekitMode(useLiveKit);

      if (!useLiveKit) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false,
          });
          const mimeTypes = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/ogg'];
          const mimeType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t));
          const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
          continuousRecorderRef.current = recorder;
          recorder.start();
        } catch (err: any) {
          console.warn('Continuous mic unavailable:', err.message);
          setMicError(err.name === 'NotAllowedError' ? 'Mic permission denied' : 'No mic available');
        }
      }

      addMessage({ role: 'system', text: useLiveKit ? 'LiveKit call started.' : 'Call started.', timestamp: Date.now() });
      setCallActive(true);

      openingTimeoutRef.current = setTimeout(() => {
        const opening = "Hi, this is Sarah in the office. Outlook won't send an email and I need it gone before my meeting.";
        addMessage({ role: 'customer', text: opening, timestamp: Date.now() });
        transcriptRef.current.push(`Customer: ${opening}`);
        speak(opening);
      }, 500);
    } catch (err: any) {
      addMessage({ role: 'system', text: `Failed to start call: ${err.message}`, timestamp: Date.now() });
    }
  }, [addMessage, speak, stop, livekit, sessionId]);

  const endCall = useCallback(async () => {
    stop();
    if (openingTimeoutRef.current) clearTimeout(openingTimeoutRef.current);
    setCallActive(false);
    setIsUtteranceActive(false);
    navigationPendingRef.current = true;
    addMessage({ role: 'system', text: 'Call ended. Analyzing...', timestamp: Date.now() });

    stopUtterance();

    if (livekitMode) {
      await livekit.endCall();
    } else if (sessionId) {
      await fetch('/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, status: 'completed' }),
      });
    }

    const recorder = continuousRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      const mimeType = recorder.mimeType || 'audio/webm';
      const blob = await new Promise<Blob | null>((resolve) => {
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            resolve(new Blob([e.data], { type: mimeType }));
          } else {
            resolve(null);
          }
        };
        recorder.stop();
      });
      recorder.stream.getTracks().forEach(t => t.stop());

      if (blob && sessionId) {
        try {
          const formData = new FormData();
          formData.append('audio', blob, 'full-call.webm');
          formData.append('session_id', sessionId);
          formData.append('duration_ms', String(Date.now() - callStartRef.current));
          const res = await fetch('/api/recording', { method: 'POST', body: formData });
          if (res.ok) {
            const data = await res.json();
            setAnalysis(data.analysis);
          }
        } catch (err) {
          console.error('Failed to upload recording:', err);
        }
      }
    }

    if (sessionId) {
      navigationPendingRef.current = false;
      navigateToAnalysis(sessionId);
    }
  }, [sessionId, addMessage, stop, livekit, livekitMode, navigateToAnalysis, stopUtterance]);

  useEffect(() => {
    setOnTtsEnd(() => {
      startUtterance();
    });
  }, [setOnTtsEnd, startUtterance]);

  useEffect(() => {
    return () => {
      if (openingTimeoutRef.current) clearTimeout(openingTimeoutRef.current);
      for (const r of [continuousRecorderRef.current, utteranceRecorderRef.current]) {
        if (r && r.state !== 'inactive') {
          r.stream?.getTracks().forEach(t => t.stop());
          r.stop();
        }
      }
    };
  }, []);

  const messagesForTranscript = messages.filter(m => m.role !== 'system');
  const lastDecision = messages.filter(m => m.decision).pop()?.decision;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'candidate' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              msg.role === 'customer' ? 'bg-blue-900/40 text-blue-100' :
              msg.role === 'candidate' ? 'bg-green-900/40 text-green-100' :
              'bg-gray-700/50 text-gray-300 text-center w-full'
            }`}>
              {msg.role !== 'system' && (
                <p className="text-xs opacity-60 mb-0.5">
                  {msg.role === 'customer' ? 'Customer' : 'You'}
                </p>
              )}
              <p>{msg.text}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-blue-900/40 rounded-lg px-3 py-2 text-sm text-blue-100">
              <span className="animate-pulse">Customer is typing...</span>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-700 p-4 space-y-3">
        {livekitMode && <div className="text-xs text-green-400">LiveKit transport active</div>}

        {micError && (
          <div className="text-xs text-yellow-400 bg-yellow-900/20 rounded px-3 py-2">
            {micError} — audio analysis will be unavailable
          </div>
        )}

        {analysis && (
          <div className="bg-gray-800 rounded-lg p-3 text-xs text-gray-300">
            <p className="font-semibold text-gray-200 mb-1">Call Analysis</p>
            <p>Talk: {(analysis.analysis?.talkRatio * 100).toFixed(0)}% | Silence: {(analysis.analysis?.silenceRatio * 100).toFixed(0)}%</p>
            <p>Longest pause: {analysis.analysis?.longestSilenceMs}ms | Segments: {analysis.analysis?.silenceSegments}</p>
            {analysis.diarization?.perSpeakerMetrics && (
              <p>Speakers: {Object.keys(analysis.diarization.perSpeakerMetrics).join(', ')}</p>
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          {!callActive ? (
            <button
              onClick={startCall}
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium"
            >
              Start Call
            </button>
          ) : (
            <>
              {!livekitMode && (
                <button
                  type="button"
                  onClick={isUtteranceActive ? stopUtterance : startUtterance}
                  disabled={!isUtteranceActive && loading}
                  className={`select-none rounded px-5 py-2.5 text-sm font-medium transition-all ${
                    isUtteranceActive
                      ? 'bg-red-600 text-white ring-2 ring-red-400 animate-pulse'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  } ${!isUtteranceActive && loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {isUtteranceActive ? 'Stop' : 'Talk'}
                </button>
              )}
              {livekitMode && (
                <div className="text-sm text-gray-400">{livekit.audioElement}LiveKit connected — speak freely</div>
              )}
              <button
                onClick={endCall}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium"
              >
                End Call
              </button>
            </>
          )}
        </div>

        {lastDecision && lastDecision.evidenceTags?.length > 0 && (
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer hover:text-gray-300">Last turn tags</summary>
            <div className="mt-1 space-y-0.5">
              {lastDecision.evidenceTags.map((tag: string) => (
                <span key={tag} className="text-[9px] bg-gray-700 text-gray-300 px-1 py-0.5 rounded">{tag}</span>
              ))}
            </div>
          </details>
        )}

        {messagesForTranscript.length > 0 && (
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer hover:text-gray-300">View transcript ({messagesForTranscript.length} turns)</summary>
            <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
              {messagesForTranscript.map((m, i) => (
                <p key={i}><span className={m.role === 'customer' ? 'text-blue-400' : 'text-green-400'}>
                  {m.role === 'customer' ? 'C' : 'Y'}:</span> {m.text.slice(0, 100)}</p>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
