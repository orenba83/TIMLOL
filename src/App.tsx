import { useEffect, useMemo } from 'react';
import { AudioLines, Sparkles } from 'lucide-react';
import { useMeetingRecorder } from '@/hooks/useMeetingRecorder';
import { loadApiKey, saveApiKey } from '@/lib/storage';
import { isDisplayMediaSupported } from '@/lib/audio';
import { ApiKeyInput } from '@/components/ApiKeyInput';
import { SourceSelector } from '@/components/SourceSelector';
import { AudioVisualizer } from '@/components/AudioVisualizer';
import { RecordingControls } from '@/components/RecordingControls';
import { TranscriptPanel } from '@/components/TranscriptPanel';
import { SummaryPanel } from '@/components/SummaryPanel';

function App() {
  const recorder = useMeetingRecorder(loadApiKey());
  const systemAudioAvailable = useMemo(() => isDisplayMediaSupported(), []);

  useEffect(() => {
    saveApiKey(recorder.apiKey);
  }, [recorder.apiKey]);

  useEffect(() => {
    if (
      !systemAudioAvailable &&
      (recorder.sourceMode === 'system' || recorder.sourceMode === 'both')
    ) {
      recorder.setSourceMode('mic');
    }
  }, [systemAudioAvailable, recorder.sourceMode, recorder.setSourceMode]);

  const canStart = !!recorder.apiKey.trim() && recorder.apiKeyValid !== false;
  const sideMode =
    recorder.isRecording || (!recorder.summary && !recorder.isProcessing)
      ? 'insights'
      : recorder.summary || (!recorder.isRecording && recorder.isProcessing)
        ? 'summary'
        : 'insights';

  return (
    <div
      dir="rtl"
      className="min-h-[100dvh] bg-slate-950 text-slate-100"
      style={{ fontFamily: "'Heebo', 'Segoe UI', sans-serif" }}
    >
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-72 sm:w-96 h-72 sm:h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-72 sm:w-96 h-72 sm:h-96 bg-emerald-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-6xl mx-auto px-3 sm:px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
        <header className="mb-6 sm:mb-8 text-center flex flex-col items-center">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3 mb-2 sm:mb-3 w-full">
            <div className="flex items-center justify-center w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-cyan-400 to-cyan-600 shadow-lg shadow-cyan-500/30 shrink-0">
              <AudioLines className="w-5 h-5 sm:w-6 sm:h-6 text-slate-900" />
            </div>
            <h1 className="text-xl sm:text-3xl font-bold text-slate-100 leading-snug text-center px-1">
              TIMLOL — תמלול וסיכום דיונים
            </h1>
          </div>
          <p className="text-slate-400 text-xs sm:text-sm flex flex-wrap items-center justify-center gap-1.5 text-center max-w-md mx-auto px-2">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>תמלול חי אוטומטי · עברית / English · תובנות תוך כדי · סיכום בסיום</span>
          </p>
        </header>

        <section className="mb-4 sm:mb-6 space-y-3 sm:space-y-4">
          <ApiKeyInput
            apiKey={recorder.apiKey}
            onChange={recorder.setApiKey}
            valid={recorder.apiKeyValid}
          />

          <div className="rounded-2xl bg-slate-800/60 border border-slate-700/50 p-3 sm:p-5 space-y-4">
            <div>
              <h2 className="text-sm font-medium text-slate-300 mb-2 sm:mb-3 text-center sm:text-right">
                בחירת מקור שמע
              </h2>
              <SourceSelector
                mode={recorder.sourceMode}
                onChange={recorder.setSourceMode}
                disabled={recorder.isRecording}
                systemAudioAvailable={systemAudioAvailable}
              />
              <p className="mt-2 text-[11px] sm:text-xs text-slate-500 text-center sm:text-right leading-relaxed">
                {systemAudioAvailable
                  ? 'לשמע מערכת ב-Chrome במחשב: בחרו טאב וסמנו Share audio. העלאת קובץ זמינה בכפתור למטה.'
                  : 'במכשיר הזה אין תמיכה בשמע מערכת (שיתוף מסך). השתמשו במיקרופון, או הקליטו את הפגישה והעלו קובץ.'}
              </p>
            </div>
          </div>
        </section>

        <section className="mb-4 sm:mb-6 rounded-2xl bg-slate-800/40 border border-slate-700/50 p-3 sm:p-5">
          <div className="flex items-center justify-between mb-2 sm:mb-3 gap-2">
            <span className="text-sm font-medium text-slate-300">
              ויזואליזטור שמע
            </span>
            {recorder.isRecording && (
              <span className="text-xs text-cyan-400 flex items-center gap-1.5 shrink-0">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                קולט שמע
              </span>
            )}
          </div>
          <AudioVisualizer
            isRecording={recorder.isRecording}
            audioLevel={recorder.audioLevel}
          />
        </section>

        <section className="mb-4 sm:mb-6 rounded-2xl bg-slate-800/40 border border-slate-700/50 p-3 sm:p-5">
          <RecordingControls
            isRecording={recorder.isRecording}
            isProcessing={recorder.isProcessing}
            elapsedSeconds={recorder.elapsedSeconds}
            status={recorder.status}
            onStart={recorder.start}
            onStop={recorder.stop}
            onReset={recorder.reset}
            onFile={recorder.processFile}
            disabled={!canStart}
          />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 pb-4">
          <div className="h-[min(52vh,380px)] sm:h-[420px]">
            <TranscriptPanel
              transcript={recorder.transcript}
              onCopy={recorder.copyTranscript}
              isProcessing={recorder.isProcessing && !recorder.isRecording}
            />
          </div>
          <div className="h-[min(52vh,380px)] sm:h-[420px]">
            <SummaryPanel
              mode={sideMode}
              insights={recorder.insights}
              summary={recorder.summary}
              tasks={recorder.tasks}
              onCopy={
                sideMode === 'summary'
                  ? recorder.copySummary
                  : recorder.copyInsights
              }
              isProcessing={recorder.isProcessing}
            />
          </div>
        </section>

        <footer className="text-center text-[11px] sm:text-xs text-slate-600 pb-4 px-2">
          רץ בדפדפן · מפתח Gemini נשמר מקומית · תמלול חי אוטומטי
        </footer>
      </div>
    </div>
  );
}

export default App;
