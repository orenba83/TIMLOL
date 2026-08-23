import { useEffect } from 'react';
import { AudioLines, Sparkles } from 'lucide-react';
import { useMeetingRecorder } from '@/hooks/useMeetingRecorder';
import { loadApiKey, saveApiKey } from '@/lib/storage';
import { ApiKeyInput } from '@/components/ApiKeyInput';
import { SourceSelector } from '@/components/SourceSelector';
import { LanguageSelector } from '@/components/LanguageSelector';
import { AudioVisualizer } from '@/components/AudioVisualizer';
import { RecordingControls } from '@/components/RecordingControls';
import { TranscriptPanel } from '@/components/TranscriptPanel';
import { SummaryPanel } from '@/components/SummaryPanel';

function App() {
  const recorder = useMeetingRecorder(loadApiKey());

  useEffect(() => {
    saveApiKey(recorder.apiKey);
  }, [recorder.apiKey]);

  const canStart = !!recorder.apiKey.trim() && recorder.apiKeyValid !== false;

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-slate-950 text-slate-100"
      style={{ fontFamily: "'Heebo', 'Segoe UI', sans-serif" }}
    >
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 py-8">
        <header className="mb-8 text-center">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-400 to-cyan-600 shadow-lg shadow-cyan-500/30">
              <AudioLines className="w-6 h-6 text-slate-900" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-100">
              TIMLOL — תמלול וסיכום דיונים
            </h1>
          </div>
          <p className="text-slate-400 text-sm flex items-center justify-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            תמלול חי בעברית, באנגלית או בשילוב — סיכום חכם בזמן אמת
          </p>
        </header>

        <section className="mb-6 space-y-4">
          <ApiKeyInput
            apiKey={recorder.apiKey}
            onChange={recorder.setApiKey}
            valid={recorder.apiKeyValid}
          />

          <div className="rounded-2xl bg-slate-800/60 border border-slate-700/50 p-5 space-y-5">
            <div>
              <h2 className="text-sm font-medium text-slate-300 mb-3">
                בחירת מקור שמע
              </h2>
              <SourceSelector
                mode={recorder.sourceMode}
                onChange={recorder.setSourceMode}
                disabled={recorder.isRecording}
              />
              <p className="mt-2 text-xs text-slate-500">
                לשמע מערכת ב-Chrome: בחרו טאב וסמנו Share audio. העלאת קובץ זמינה בכפתור למטה.
              </p>
            </div>
            <LanguageSelector
              mode={recorder.language}
              onChange={recorder.setLanguage}
              disabled={recorder.isRecording}
            />
          </div>
        </section>

        <section className="mb-6 rounded-2xl bg-slate-800/40 border border-slate-700/50 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-slate-300">
              ויזואליזטור שמע
            </span>
            {recorder.isRecording && (
              <span className="text-xs text-cyan-400 flex items-center gap-1.5">
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

        <section className="mb-6 rounded-2xl bg-slate-800/40 border border-slate-700/50 p-5">
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

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 pb-8">
          <div className="h-[420px]">
            <TranscriptPanel
              transcript={recorder.transcript}
              onCopy={recorder.copyTranscript}
              isProcessing={recorder.isProcessing && !recorder.isRecording}
            />
          </div>
          <div className="h-[420px]">
            <SummaryPanel
              summary={recorder.summary}
              tasks={recorder.tasks}
              onCopy={recorder.copySummary}
              isProcessing={recorder.isProcessing && !recorder.isRecording}
            />
          </div>
        </section>

        <footer className="text-center text-xs text-slate-600 pb-8">
          רץ בדפדפן · מפתח Gemini נשמר מקומית · עברית ↔ English
        </footer>
      </div>
    </div>
  );
}

export default App;
