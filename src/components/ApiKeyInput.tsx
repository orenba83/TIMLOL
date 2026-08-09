import { useState } from 'react';
import { Key, Eye, EyeOff, Check, X, Loader2 } from 'lucide-react';

interface ApiKeyInputProps {
  apiKey: string;
  onChange: (key: string) => void;
  valid: boolean | null;
}

export function ApiKeyInput({ apiKey, onChange, valid }: ApiKeyInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="rounded-2xl bg-slate-800/60 border border-slate-700/50 p-5">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-3">
        <Key className="w-4 h-4 text-cyan-400" />
        מפתח Google Gemini API
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={visible ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => onChange(e.target.value)}
            placeholder="הזן מפתח API מ-Google AI Studio"
            dir="ltr"
            className="w-full bg-slate-900/80 text-slate-100 placeholder-slate-500 rounded-xl border border-slate-700 px-4 py-2.5 pl-11 text-sm font-mono focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition"
            aria-label="הצג/הסתר מפתח"
          >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex items-center justify-center w-10">
          {valid === true && (
            <span className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400">
              <Check className="w-4 h-4" />
            </span>
          )}
          {valid === false && (
            <span className="flex items-center justify-center w-7 h-7 rounded-full bg-rose-500/20 text-rose-400">
              <X className="w-4 h-4" />
            </span>
          )}
          {valid === null && apiKey && (
            <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        המפתח נשמר באופן מקומי בדפדפן בלבד. קבלו מפתח חינמי ב{' '}
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-400 hover:underline"
          dir="ltr"
        >
          Google AI Studio
        </a>
        .
      </p>
    </div>
  );
}
