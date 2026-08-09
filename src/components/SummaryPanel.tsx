import { Copy, ClipboardList, ListChecks, User, CalendarClock } from 'lucide-react';
import type { TaskItem } from '@/lib/types';

interface SummaryPanelProps {
  summary: string;
  tasks: TaskItem[];
  onCopy: () => void;
  isProcessing: boolean;
}

export function SummaryPanel({
  summary,
  tasks,
  onCopy,
  isProcessing,
}: SummaryPanelProps) {
  return (
    <div className="flex flex-col h-full rounded-2xl bg-slate-800/40 border border-slate-700/50 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/50 bg-slate-800/60">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <ClipboardList className="w-4 h-4 text-emerald-400" />
          סיכום דיון
        </div>
        <button
          type="button"
          onClick={onCopy}
          disabled={!summary && tasks.length === 0}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-emerald-300 disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          <Copy className="w-3.5 h-3.5" />
          העתק
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">
          {summary ? (
            summary
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500 text-center gap-2">
              <ClipboardList className="w-8 h-8 opacity-40" />
              <p>הסיכום ייווצר אוטומטית תוך כדי הדיון</p>
              {isProcessing && (
                <p className="text-xs text-emerald-400/70">מעדכן סיכום…</p>
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
      </div>
    </div>
  );
}
