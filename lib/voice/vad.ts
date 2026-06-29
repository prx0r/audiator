export interface VadConfig {
  threshold: number;
  silenceTimeoutMs: number;
  minSpeechMs: number;
  pollIntervalMs: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  threshold: 0.02,
  silenceTimeoutMs: 500,
  minSpeechMs: 200,
  pollIntervalMs: 30,
};

export interface VadEvent {
  type: 'speech_start' | 'speech_end' | 'silence' | 'error';
  timestamp: number;
  rms?: number;
  durationMs?: number;
}

export type VadCallback = (event: VadEvent) => void;

export function startVad(
  stream: MediaStream,
  config: VadConfig = DEFAULT_VAD_CONFIG,
  onEvent: VadCallback,
): () => void {
  let active = true;
  let speaking = false;
  let speechStartMs = 0;
  let silenceStartMs = 0;
  let lastRms = 0;

  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  function computeRms(): number {
    analyser.getByteTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const val = (dataArray[i] - 128) / 128;
      sum += val * val;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    lastRms = rms;
    return rms;
  }

  function loop() {
    if (!active) return;
    const rms = computeRms();
    const now = Date.now();

    if (rms > config.threshold) {
      if (!speaking) {
        speaking = true;
        speechStartMs = now;
        onEvent({ type: 'speech_start', timestamp: now, rms });
      }
      silenceStartMs = 0;
    } else {
      if (speaking) {
        if (silenceStartMs === 0) {
          silenceStartMs = now;
        } else if (now - silenceStartMs >= config.silenceTimeoutMs) {
          const duration = now - speechStartMs;
          if (duration >= config.minSpeechMs) {
            speaking = false;
            silenceStartMs = 0;
            onEvent({ type: 'speech_end', timestamp: now, rms, durationMs: duration });
          } else {
            speaking = false;
            silenceStartMs = 0;
          }
        }
      }
      onEvent({ type: 'silence', timestamp: now, rms });
    }

    setTimeout(loop, config.pollIntervalMs);
  }

  loop();

  return () => {
    active = false;
    source.disconnect();
    audioCtx.close();
  };
}

export function endOfSpeechMs(
  audioBlob: Blob,
  sampleRate: number = 16000,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const arrayBuffer = reader.result as ArrayBuffer;
        const audioCtx = new AudioContext({ sampleRate });
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const channel = audioBuffer.getChannelData(0);
        const threshold = 0.02;
        let lastSpeechIdx = 0;
        const windowSize = Math.floor(sampleRate * 0.03);
        for (let i = 0; i < channel.length; i += windowSize) {
          let sum = 0;
          const end = Math.min(i + windowSize, channel.length);
          for (let j = i; j < end; j++) {
            sum += channel[j] * channel[j];
          }
          const rms = Math.sqrt(sum / (end - i));
          if (rms > threshold) lastSpeechIdx = i;
        }
        const endMs = (lastSpeechIdx / sampleRate) * 1000;
        audioCtx.close();
        resolve(endMs);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(audioBlob);
  });
}
