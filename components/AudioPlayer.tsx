'use client';

import { useRef, useCallback, useState } from 'react';

export function useAudioPlayer() {
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const onTtsEndRef = useRef<(() => void) | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const speak = useCallback(async (text: string) => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      if (currentAudioRef.current.src) URL.revokeObjectURL(currentAudioRef.current.src);
      currentAudioRef.current = null;
    }

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) return;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      setAutoplayBlocked(false);

      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (currentAudioRef.current === audio) currentAudioRef.current = null;
        onTtsEndRef.current?.();
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (currentAudioRef.current === audio) currentAudioRef.current = null;
        onTtsEndRef.current?.();
      };

      try {
        await audio.play();
      } catch (playErr: any) {
        if (playErr.name === 'NotAllowedError') {
          setAutoplayBlocked(true);
        }
      }
    } catch {
      // TTS fetch failed
    }
  }, []);

  const stop = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      if (currentAudioRef.current.src) URL.revokeObjectURL(currentAudioRef.current.src);
      currentAudioRef.current = null;
    }
  }, []);

  return {
    speak,
    stop,
    autoplayBlocked,
    setOnTtsEnd: (cb: () => void) => { onTtsEndRef.current = cb; },
  };
}
