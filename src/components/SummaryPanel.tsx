import {
  Copy,
  ClipboardList,
  ListChecks,
  User,
  CalendarClock,
  Lightbulb,
  AlertTriangle,
} from 'lucide-react';
import type { InsightItem, TaskItem } from '@/lib/types';

interface SummaryPanelProps {
  mode: 'insights' | 'summary';
  insights: InsightItem[];
  summary: string;
  tasks: TaskItem[];
  onCopy: () => void;
  isProcessing: boolean;
}

export function SummaryPanel({
  mode,
  insights,
  summary,
  tasks,
  onCopy,
  isProcessing,
}: SummaryPanelProps) {
  const canCopy =
    mode === 'summary'
      ? !!summary || tasks.length > 0
      : insights.length > 0;

  return (
    <div className="flex flex-col h-full rounded-2xl bg-slate-800/40 border border-slate-700/50 overflow-hidden">
      <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-slate-700/50 bg-slate-800/60">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
          {mode === 'summary' ? (
            <>
              <ClipboardList className="w-4 h-4 text-emerald-400" />
              סיכום דיון
            </>
          ) : (
            <>
              <Lightbulb className="w-4 h-4 text-amber-400" />
              תובנות מהדיון
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onCopy}
          disabled={!canCopy}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-emerald-300 disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          <Copy className="w-3.5 h-3.5" />
          העתק
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
        {mode === 'insights' ? (
          insights.length > 0 ? (
            <ul className="space-y-2">
              {insights.map((item, i) => (
                <li
                  key={`${i}-${item.text.slice(0, 24)}`}
                  className={`rounded-xl border px-3 py-2.5 text-sm leading-relaxed ${
                    item.kind === 'conflict'
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-100'
                      : 'border-slate-700/50 bg-slate-900/40 text-slate-200'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {item.kind === 'conflict' ? (
                      <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
                    ) : (
                      <Lightbulb className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                    )}
                    <span>
                      {item.kind === 'conflict' && (
                        <span className="block text-[10px] font-medium text-rose-300 mb-0.5">
                          לבירור / קונפליקט
                        </span>
                      )}
                      {item.text}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500 text-center gap-2">
              <Lightbulb className="w-8 h-8 opacity-40" />
              <p className="text-sm">תוך כדי הדיון יופיעו כאן תובנות ונקודות לבירור</p>
              {isProcessing && (
                <p className="text-xs text-amber-400/70">מעדכן תובנות…</p>
              )}
            </div>
          )
        ) : (
          <>
            <div className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">
              {summary ? (
                summary
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-slate-500 text-center gap-2">
                  <ClipboardList className="w-8 h-8 opacity-40" />
                  <p>הסיכום יופיע בסיום הדיון</p>
                  {isProcessing && (
                    <p className="text-xs text-emerald-400/70">יוצר סיכום…</p>
                  )}
                </div>
              )}
            </div>

            {tasks.length > 0 && (
              <div className="pt-2">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-200 mb-3">
                  <ListChecks className="w-4 h-4 text-amber-400" />
                  טבלת משימות
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-700/50">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-900/60 text-slate-400 text-xs">
                        <th className="text-right font-medium px-3 py-2">תיאור</th>
                        <th className="text-right font-medium px-3 py-2 whitespace-nowrap">
                          <User className="w-3.5 h-3.5 inline ml-1" />
                          אחראי
                        </th>
                        <th className="text-right font-medium px-3 py-2 whitespace-nowrap">
                          <CalendarClock className="w-3.5 h-3.5 inline ml-1" />
                          יעד
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((t, i) => (
                        <tr
                          key={i}
                          className="border-t border-slate-700/40 hover:bg-slate-800/40 transition"
                        >
                          <td className="px-3 py-2.5 text-slate-200">{t.task}</td>
                          <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">
                            {t.assignee}
                          </td>
                          <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">
                            {t.dueDate}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
