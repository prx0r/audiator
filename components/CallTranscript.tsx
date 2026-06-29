'use client';

interface Message {
  role: 'customer' | 'candidate' | 'system';
  text: string;
  timestamp?: number;
}

export function CallTranscript({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return (
      <div className="text-gray-500 text-sm p-4 border border-dashed border-gray-600 rounded-lg">
        No messages yet. Start the call to begin.
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-96 overflow-y-auto">
      {messages.map((msg, i) => (
        <div
          key={i}
          className={`p-2 rounded-lg text-sm ${
            msg.role === 'customer'
              ? 'bg-blue-900/30 ml-4'
              : msg.role === 'candidate'
              ? 'bg-green-900/30 mr-4'
              : 'bg-gray-700/30 text-center'
          }`}
        >
          <span className={`text-xs font-semibold ${
            msg.role === 'customer' ? 'text-blue-400' : msg.role === 'candidate' ? 'text-green-400' : 'text-gray-400'
          }`}>
            {msg.role === 'customer' ? 'Customer' : msg.role === 'candidate' ? 'You' : 'System'}
          </span>
          <p className="text-gray-200 mt-0.5">{msg.text}</p>
        </div>
      ))}
    </div>
  );
}
