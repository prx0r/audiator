'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { VoiceRecorderButton, VoiceTranscriptResult } from './VoiceRecorderButton';
import { useAudioPlayer } from './AudioPlayer';

interface Message {
  role: 'customer' | 'candidate' | 'system';
  text: string;
  timestamp: number;
}

export function VoiceChat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [callActive, setCallActive] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const flushRef = useRef(0);
  const autoRecordRef = useRef(0);
  const fullCallBlobRef = useRef<Blob | null>(null);
  const transcriptRef = useRef<string[]>([]);
  const { speak, stop, autoplayBlocked, setOnTtsEnd } = useAudioPlayer();
  const chatHistoryRef = useRef<Array<{ role: string; content: string }>>([]);

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
          history: chatHistoryRef.current,
        }),
      });

      if (!res.ok) throw new Error('Chat failed');

      const data = await res.json();
      const reply = data.reply;

      chatHistoryRef.current.push({ role: 'user', content: text });
      chatHistoryRef.current.push({ role: 'assistant', content: reply });

      addMessage({ role: 'customer', text: reply, timestamp: Date.now() });
      transcriptRef.current.push(`Customer: ${reply}`);

      await speak(reply);
    } catch (err: any) {
      addMessage({ role: 'system', text: `Error: ${err.message}`, timestamp: Date.now() });
    } finally {
      setLoading(false);
    }
  }, [addMessage, speak]);

  const handleFullRecording = useCallback(async (blob: Blob, mimeType: string) => {
    if (!sessionId) return;

    const formData = new FormData();
    formData.append('audio', blob, 'full-call.webm');
    formData.append('session_id', sessionId);
    formData.append('duration_ms', String(Date.now()));

    try {
      const res = await fetch('/api/recording', { method: 'POST', body: formData });
      if (res.ok) {
        const data = await res.json();
        setAnalysis(data.analysis);
        addMessage({ role: 'system', text: 'Call saved and analyzed.', timestamp: Date.now() });
      }
    } catch (err) {
      console.error('Failed to upload recording:', err);
    }
  }, [sessionId, addMessage]);

  const startCall = useCallback(async () => {
    stop();
    setMessages([]);
    setAnalysis(null);
    transcriptRef.current = [];
    chatHistoryRef.current = [];

    try {
      const res = await fetch('/api/session', { method: 'POST' });
      const data = await res.json();
      setSessionId(data.id);

      addMessage({ role: 'system', text: 'Call started. Hold the mic to speak.', timestamp: Date.now() });
      setCallActive(true);

      setTimeout(() => {
        const opening = 'Hi, I\'m having trouble with my computer — can you help?';
        addMessage({ role: 'customer', text: opening, timestamp: Date.now() });
        transcriptRef.current.push(`Customer: ${opening}`);
        speak(opening);
      }, 500);
    } catch (err: any) {
      addMessage({ role: 'system', text: `Failed to start call: ${err.message}`, timestamp: Date.now() });
    }
  }, [addMessage, speak, stop]);

  const endCall = useCallback(async () => {
    stop();
    setCallActive(false);

    if (sessionId) {
      await fetch('/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, status: 'completed' }),
      });

      flushRef.current++;
    }

    addMessage({ role: 'system', text: 'Call ended. Analyzing...', timestamp: Date.now() });
  }, [sessionId, addMessage, stop]);

  useEffect(() => {
    setOnTtsEnd(() => {
      autoRecordRef.current++;
    });
  }, [setOnTtsEnd]);

  const messagesForTranscript = messages.filter(m => m.role !== 'system');

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
              <VoiceRecorderButton
                sessionId={sessionId || ''}
                onTranscript={handleTranscript}
                disabled={loading}
                autoRecordTrigger={autoRecordRef.current}
                onRecordingStarted={() => {}}
                flushRecordingTrigger={flushRef.current}
                onFullRecording={handleFullRecording}
              />
              <button
                onClick={endCall}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium"
              >
                End Call
              </button>
            </>
          )}
        </div>

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
