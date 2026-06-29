import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Audiator — Voice Call Analysis",
  description: "Voice call recording, transcription, and acoustic analysis engine",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 py-3">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <h1 className="text-lg font-bold text-[var(--accent)]">audiator</h1>
            <span className="text-xs text-[var(--text-secondary)]">voice call analysis engine</span>
          </div>
        </header>
        <main className="flex-1 max-w-5xl mx-auto w-full p-4">
          {children}
        </main>
      </body>
    </html>
  );
}
