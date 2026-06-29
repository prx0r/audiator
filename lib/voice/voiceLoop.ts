export interface LatencyMetrics {
  endOfSpeechMs: number;
  sttMs: number;
  llmFirstTokenMs: number;
  ttsFirstAudioMs: number;
  totalTurnMs: number;
}

export function createLatencyTracker() {
  const marks: Record<string, number> = {};

  return {
    mark(name: string) { marks[name] = Date.now(); },
    get(name: string) { return marks[name]; },
    computeFinal(): LatencyMetrics {
      const now = Date.now();
      return {
        endOfSpeechMs: marks.endOfSpeech ? marks.endOfSpeech - (marks.turnStart || marks.endOfSpeech) : 0,
        sttMs: marks.sttEnd ? marks.sttEnd - (marks.sttStart || marks.sttEnd) : 0,
        llmFirstTokenMs: marks.llmFirstToken ? marks.llmFirstToken - (marks.sttEnd || marks.llmFirstToken) : 0,
        ttsFirstAudioMs: marks.ttsFirstAudio ? marks.ttsFirstAudio - (marks.llmFirstToken || marks.ttsFirstAudio) : 0,
        totalTurnMs: now - (marks.turnStart || now),
      };
    },
    reset() { Object.keys(marks).forEach(k => delete marks[k]); },
  };
}

export function createPhraseChunker(
  onPhrase: (phrase: string) => void,
  onComplete: (fullText: string) => void,
) {
  let buffer = '';

  return {
    addToken(token: string) {
      buffer += token;
      const sentenceEnd = /[.。!！?？\n](?=\s|$)/g;
      let match;
      while ((match = sentenceEnd.exec(buffer)) !== null) {
        const endIdx = match.index + 1;
        const sentence = buffer.slice(0, endIdx).trim();
        if (sentence) onPhrase(sentence);
        buffer = buffer.slice(endIdx).trim();
        sentenceEnd.lastIndex = 0;
      }
    },
    flush() {
      if (buffer.trim()) onPhrase(buffer.trim());
      buffer = '';
    },
    finish() {
      this.flush();
      onComplete('');
    },
    get pending() { return buffer; },
  };
}

export function createTtsQueue(
  sessionId: string,
  onStarted?: () => void,
  onComplete?: () => void,
) {
  const queue: { text: string; id: number }[] = [];
  let playing = false;
  let cancelled = false;
  let currentId = 0;
  let enqueueId = 0;
  let currentAudio: HTMLAudioElement | null = null;

  async function playNext() {
    if (cancelled || queue.length === 0) {
      playing = false;
      onComplete?.();
      return;
    }
    playing = true;
    const item = queue.shift()!;
    onStarted?.();

    try {
      const res = await fetch(`/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: item.text, sessionId }),
      });
      if (!res.ok || cancelled) { playing = false; onComplete?.(); return; }
      const blob = await res.blob();
      if (cancelled) { playing = false; onComplete?.(); return; }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      await audio.play();
      if (!cancelled) playNext();
    } catch {
      if (!cancelled) playNext();
    }
  }

  return {
    enqueue(text: string): number {
      const id = ++enqueueId;
      queue.push({ text, id });
      if (!playing && !cancelled) playNext();
      return id;
    },
    cancel() {
      cancelled = true;
      if (currentAudio) { currentAudio.pause(); currentAudio = null; }
      queue.length = 0;
      playing = false;
    },
    isPlaying() { return playing; },
    reset() {
      this.cancel();
      cancelled = false;
      currentId = 0;
      enqueueId = 0;
    },
  };
}
