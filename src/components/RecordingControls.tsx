import { useRef } from 'react';
import { Play, Square, RotateCcw, Upload, Loader2 } from 'lucide-react';
import { formatTime } from '@/lib/audio';
import type { RecordingStatus } from '@/lib/types';

interface RecordingControlsProps {
  isRecording: boolean;
  isProcessing: boolean;
  elapsedSeconds: number;
  status: RecordingStatus;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function RecordingControls({
  isRecording,
  isProcessing,
  elapsedSeconds,
  status,
  onStart,
  onStop,
  onReset,
  onFile,
  disabled,
}: RecordingControlsProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const statusColor =
    status.status === 'error'
      ? 'text-rose-400'
      : status.status === 'processing' || status.status === 'file-processing'
        ? 'text-amber-400'
        : status.status === 'recording'
          ? 'text-cyan-400'
          : 'text-slate-400';

  return (
    <div className="flex flex-col gap-3 items-stretch">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="grid grid-cols-1 xs:grid-cols-3 sm:flex sm:flex-wrap items-stretch sm:items-center gap-2 w-full sm:w-auto">
          {!isRecording ? (
            <button
              type="button"
              onClick={onStart}
              disabled={disabled || isProcessing}
              className="flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 sm:py-2.5 font-medium text-slate-900 hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-lg shadow-cyan-500/20 w-full sm:w-auto col-span-full sm:col-auto"
            >
              <Play className="w-4 h-4" fill="currentColor" />
              התחל הקלטה
            </button>
          ) : (
            <button
              type="button"
              onClick={onStop}
              className="flex items-center justify-center gap-2 rounded-xl bg-rose-500 px-4 py-3 sm:py-2.5 font-medium text-white hover:bg-rose-400 transition shadow-lg shadow-rose-500/20 w-full sm:w-auto col-span-full sm:col-auto"
            >
              <Square className="w-4 h-4" fill="currentColor" />
              עצור
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            disabled={isRecording}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-slate-300 hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition w-full sm:w-auto"
          >
            <RotateCcw className="w-4 h-4" />
            איפוס
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={isRecording || isProcessing}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-slate-300 hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition w-full sm:w-auto"
          >
            <Upload className="w-4 h-4" />
            העלאת קובץ
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className="flex items-center justify-center sm:justify-end gap-3 min-h-[1.75rem]">
          {isRecording && (
            <div className="flex items-center gap-2 font-mono text-lg text-cyan-300">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
              {formatTime(elapsedSeconds)}
            </div>
          )}
          {isProcessing && !isRecording && (
            <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
          )}
        </div>
      </div>

      <div
        className={`text-xs ${statusColor} flex items-center justify-center sm:justify-start gap-1.5 text-center sm:text-right`}
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
            status.status === 'recording'
              ? 'bg-cyan-400 animate-pulse'
              : status.status === 'error'
                ? 'bg-rose-400'
                : status.status === 'processing' ||
                    status.status === 'file-processing'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-slate-500'
          }`}
        />
        <span className="leading-snug">{status.message}</span>
      </div>
    </div>
  );
}
