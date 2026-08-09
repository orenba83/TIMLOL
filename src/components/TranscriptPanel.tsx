import { useEffect, useRef } from 'react';
import { Copy, FileText } from 'lucide-react';

interface TranscriptPanelProps {
  transcript: string;
  onCopy: () => void;
  isProcessing: boolean;
}

export function TranscriptPanel({
  transcript,
  onCopy,
  isProcessing,
}: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  return (
    <div className="flex flex-col h-full rounded-2xl bg-slate-800/40 border border-slate-700/50 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/50 bg-slate-800/60">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <FileText className="w-4 h-4 text-cyan-400" />
          תמלול חי
        </div>
        <button
          type="button"
          onClick={onCopy}
          disabled={!transcript}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300 disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          <Copy className="w-3.5 h-3.5" />
          העתק
        </button>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-5 text-slate-200 text-sm leading-relaxed whitespace-pre-wrap"
      >
        {transcript ? (
          transcript
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 text-center gap-2">
            <FileText className="w-8 h-8 opacity-40" />
            <p>התמלול יופיע כאן בזמן אמת</p>
            {isProcessing && (
              <p className="text-xs text-cyan-400/70">מעבד שמע…</p>
            )}
          </div>
        )}
        {isProcessing && transcript && (
          <span className="inline-block w-2 h-4 bg-cyan-400 animate-pulse mr-1 align-middle" />
        )}
      </div>
    </div>
  );
}
