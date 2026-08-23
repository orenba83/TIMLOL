import { Languages } from 'lucide-react';
import type { LanguageMode } from '@/lib/types';

interface LanguageSelectorProps {
  mode: LanguageMode;
  onChange: (m: LanguageMode) => void;
  disabled?: boolean;
}

const OPTIONS: Array<{ value: LanguageMode; label: string; desc: string }> = [
  { value: 'auto', label: 'עברית + English', desc: 'זיהוי אוטומטי / מעורב' },
  { value: 'he', label: 'עברית', desc: 'דיון בעברית' },
  { value: 'en', label: 'English', desc: 'English discussion' },
];

export function LanguageSelector({
  mode,
  onChange,
  disabled,
}: LanguageSelectorProps) {
  return (
    <div>
      <h2 className="text-sm font-medium text-slate-300 mb-2 sm:mb-3 flex items-center justify-center sm:justify-start gap-2">
        <Languages className="w-4 h-4 text-cyan-400" />
        שפת הדיון
      </h2>
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
        {OPTIONS.map(({ value, label, desc }) => {
          const active = mode === value;
          return (
            <button
              key={value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(value)}
              className={`flex flex-col items-center justify-center gap-0.5 sm:gap-1 rounded-xl border p-2 sm:p-3 text-center transition min-h-[4rem] sm:min-h-0 ${
                active
                  ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                  : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:border-slate-600 hover:text-slate-300'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <span className="text-xs sm:text-sm font-medium leading-tight">{label}</span>
              <span className="text-[10px] sm:text-[11px] opacity-70 leading-tight">{desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
