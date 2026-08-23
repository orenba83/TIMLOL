import { Mic, MonitorSpeaker, Mic2 } from 'lucide-react';
import type { AudioSourceMode } from '@/lib/types';

interface SourceSelectorProps {
  mode: AudioSourceMode;
  onChange: (m: AudioSourceMode) => void;
  disabled?: boolean;
}

const OPTIONS: Array<{
  value: AudioSourceMode;
  label: string;
  desc: string;
  Icon: typeof Mic;
}> = [
  { value: 'mic', label: 'מיקרופון', desc: 'קול מהמיקרופון', Icon: Mic },
  {
    value: 'system',
    label: 'שמע מערכת',
    desc: 'טאב / פגישת זום',
    Icon: MonitorSpeaker,
  },
  {
    value: 'both',
    label: 'משולב',
    desc: 'מיקרופון + שמע מערכת',
    Icon: Mic2,
  },
];

export function SourceSelector({ mode, onChange, disabled }: SourceSelectorProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {OPTIONS.map(({ value, label, desc, Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(value)}
            className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition ${
              active
                ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:border-slate-600 hover:text-slate-300'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <Icon className="w-5 h-5" />
            <span className="text-sm font-medium">{label}</span>
            <span className="text-[11px] opacity-70">{desc}</span>
          </button>
        );
      })}
    </div>
  );
}
