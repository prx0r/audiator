import { VoiceChat } from '@/components/VoiceChat';

export default function Home() {
  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-white">Voice Call Interface</h2>
        <p className="text-sm text-gray-400 mt-1">
          Hold the mic to speak to an AI customer. End the call to analyze the recording.
        </p>
      </div>
      <div className="flex-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl overflow-hidden">
        <VoiceChat />
      </div>
    </div>
  );
}
