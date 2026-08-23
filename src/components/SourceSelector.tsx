import { Mic, MonitorSpeaker, Mic2 } from 'lucide-react';
import type { AudioSourceMode } from '@/lib/types';

interface SourceSelectorProps {
  mode: AudioSourceMode;
  onChange: (m: AudioSourceMode) => void;
  disabled?: boolean;
  systemAudioAvailable?: boolean;
}

const OPTIONS: Array<{
  value: AudioSourceMode;
  label: string;
  desc: string;
  Icon: typeof Mic;
  needsDisplayMedia?: boolean;
}> = [
  { value: 'mic', label: 'מיקרופון', desc: 'קול מהמיקרופון', Icon: Mic },
  {
    value: 'system',
    label: 'שמע מערכת',
    desc: 'טאב / פגישת זום',
    Icon: MonitorSpeaker,
    needsDisplayMedia: true,
  },
  {
    value: 'both',
    label: 'משולב',
    desc: 'מיקרופון + שמע מערכת',
    Icon: Mic2,
    needsDisplayMedia: true,
  },
];

export function SourceSelector({
  mode,
  onChange,
  disabled,
  systemAudioAvailable = true,
}: SourceSelectorProps) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
      {OPTIONS.map(({ value, label, desc, Icon, needsDisplayMedia }) => {
        const active = mode === value;
        const unavailable = !!needsDisplayMedia && !systemAudioAvailable;
        return (
          <button
            key={value}
            type="button"
            disabled={disabled || unavailable}
            onClick={() => onChange(value)}
            title={
              unavailable
                ? 'לא נתמך בטלפון / בדפדפן הזה — השתמשו במיקרופון או העלו קובץ'
                : undefined
            }
            className={`flex flex-col items-center justify-center gap-1 rounded-xl border p-2 sm:p-3 text-center transition min-h-[4.5rem] sm:min-h-0 ${
              active
                ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:border-slate-600 hover:text-slate-300'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-xs sm:text-sm font-medium leading-tight">{label}</span>
            <span className="text-[10px] sm:text-[11px] opacity-70 leading-tight">
              {unavailable ? 'לא נתמך כאן' : desc}
            </span>
          </button>
        );
      })}
    </div>
  );
}
