import type { ChunkSeconds } from '@/lib/types';

interface DelaySliderProps {
  seconds: ChunkSeconds;
  onChange: (s: ChunkSeconds) => void;
}

const MARKS: ChunkSeconds[] = [1, 2, 3];

export function DelaySlider({ seconds, onChange }: DelaySliderProps) {
  return (
    <div className="rounded-2xl bg-slate-800/40 border border-slate-700/50 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-slate-300">דיליי תמלול</span>
        <span className="text-xs font-mono text-cyan-300">{seconds} שנ׳ לצ׳אנק</span>
      </div>
      <input
        type="range"
        min={1}
        max={3}
        step={1}
        value={seconds}
        onChange={(e) => onChange(Number(e.target.value) as ChunkSeconds)}
        className="w-full accent-cyan-400 cursor-pointer"
        aria-label="אורך צ'אנק תמלול בשניות"
      />
      <div className="flex justify-between text-[11px] text-slate-500 mt-1 px-0.5">
        {MARKS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={m === seconds ? 'text-cyan-300' : 'hover:text-slate-300'}
          >
            {m}ש
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500 leading-relaxed text-center sm:text-right">
        1ש = טקסט מופיע מהר יותר · 3ש = פחות קריאות API, משפטים שלמים יותר. אפשר לשנות תוך כדי הקלטה.
      </p>
    </div>
  );
}
