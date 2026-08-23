import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHUNK_INTERVAL_MS,
  PcmRecorder,
  fileToWavChunks,
  getAudioStream,
} from '@/lib/audio';
import {
  summarizeTranscript,
  transcribeAudioChunk,
  validateApiKey,
} from '@/lib/gemini';
import type {
  AudioSourceMode,
  GeminiSummaryResponse,
  LanguageMode,
  RecordingStatus,
  TaskItem,
} from '@/lib/types';

interface UseMeetingRecorderResult {
  apiKey: string;
  setApiKey: (key: string) => void;
  apiKeyValid: boolean | null;
  sourceMode: AudioSourceMode;
  setSourceMode: (m: AudioSourceMode) => void;
  language: LanguageMode;
  setLanguage: (m: LanguageMode) => void;
  isRecording: boolean;
  isProcessing: boolean;
  status: RecordingStatus;
  transcript: string;
  summary: string;
  tasks: TaskItem[];
  elapsedSeconds: number;
  audioLevel: number;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
  processFile: (file: File) => Promise<void>;
  copyTranscript: () => void;
  copySummary: () => void;
}

const MAX_CHUNKS_PER_SUMMARY = 2;
const RATE_LIMIT_RETRY_MS = 30000;

export function useMeetingRecorder(
  initialApiKey: string
): UseMeetingRecorderResult {
  const [apiKey, setApiKeyState] = useState(initialApiKey);
  const [apiKeyValid, setApiKeyValid] = useState<boolean | null>(null);
  const [sourceMode, setSourceMode] = useState<AudioSourceMode>('mic');
  const [language, setLanguage] = useState<LanguageMode>('auto');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<RecordingStatus>({
    status: 'idle',
    message: 'מוכן להתחלה',
  });
  const [transcript, setTranscript] = useState('');
  const [summary, setSummary] = useState('');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);

  const pcmRecorderRef = useRef<PcmRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const transcriptRef = useRef('');
  const chunksSinceSummaryRef = useRef(0);
  const summarizingRef = useRef(false);
  const stoppingRef = useRef(false);
  const flushingRef = useRef(false);
  const rateLimitedUntilRef = useRef(0);
  const apiKeyRef = useRef(apiKey);
  const languageRef = useRef(language);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    apiKeyRef.current = apiKey;
  }, [apiKey]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const setApiKey = useCallback((key: string) => {
    setApiKeyState(key);
    setApiKeyValid(null);
  }, []);

  const verifyKey = useCallback(async (key: string) => {
    if (!key.trim()) {
      setApiKeyValid(false);
      return;
    }
    const valid = await validateApiKey(key);
    setApiKeyValid(valid);
  }, []);

  useEffect(() => {
    if (apiKey) verifyKey(apiKey);
  }, [apiKey, verifyKey]);

  const updateAudioLevel = useCallback(() => {
    const recorder = pcmRecorderRef.current;
    if (!recorder) return;
    const analyser = recorder.getAnalyser();
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    setAudioLevel(Math.min(1, rms * 3));
    rafRef.current = requestAnimationFrame(updateAudioLevel);
  }, []);

  const runSummary = useCallback(async (text: string) => {
    if (!text || summarizingRef.current) return;
    summarizingRef.current = true;
    try {
      const s: GeminiSummaryResponse = await summarizeTranscript(
        apiKeyRef.current,
        text,
        languageRef.current
      );
      setSummary(s.summary);
      setTasks(s.tasks);
    } catch (err) {
      console.error('Summary error:', err);
    } finally {
      summarizingRef.current = false;
    }
  }, []);

  const transcribeBase64 = useCallback(async (base64: string) => {
    const result = await transcribeAudioChunk(
      apiKeyRef.current,
      base64,
      'audio/wav',
      languageRef.current
    );
    if (result.isRealSpeech && result.transcript) {
      setTranscript((prev) => {
        const next = prev ? `${prev} ${result.transcript}` : result.transcript;
        transcriptRef.current = next;
        return next;
      });
      chunksSinceSummaryRef.current += 1;
    }
    if (
      chunksSinceSummaryRef.current >= MAX_CHUNKS_PER_SUMMARY &&
      !summarizingRef.current
    ) {
      chunksSinceSummaryRef.current = 0;
      void runSummary(transcriptRef.current);
    }
  }, [runSummary]);

  const flushChunks = useCallback(async (): Promise<void> => {
    const recorder = pcmRecorderRef.current;
    if (!recorder || !recorder.hasAudio()) return;
    if (flushingRef.current) return;

    const now = Date.now();
    if (now < rateLimitedUntilRef.current) {
      const waitSec = Math.ceil((rateLimitedUntilRef.current - now) / 1000);
      setStatus({
        status: 'recording',
        message: `ממתין לאיפוס מכסה (${waitSec}ש)…`,
      });
      return;
    }

    flushingRef.current = true;
    setIsProcessing(true);
    setStatus({ status: 'processing', message: 'מעבד שמע…' });

    try {
      const base64 = recorder.takeWavBase64();
      if (!base64) return;
      await transcribeBase64(base64);
      if (!stoppingRef.current) {
        setStatus({ status: 'recording', message: 'מקליט' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה לא ידועה';
      if (msg.includes('429')) {
        rateLimitedUntilRef.current = Date.now() + RATE_LIMIT_RETRY_MS;
        setStatus({
          status: 'recording',
          message: 'הגעת למכסה הרגעית. ממתין 30 שניות וממשיך…',
        });
      } else {
        setStatus({ status: 'error', message: msg });
      }
    } finally {
      setIsProcessing(false);
      flushingRef.current = false;
    }
  }, [transcribeBase64]);

  const start = useCallback(async () => {
    if (!apiKeyRef.current.trim()) {
      setStatus({ status: 'error', message: 'נא להזין מפתח API תחילה' });
      return;
    }
    try {
      const stream = await getAudioStream(sourceMode);
      streamRef.current = stream;

      const recorder = new PcmRecorder(stream);
      pcmRecorderRef.current = recorder;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateAudioLevel);

      chunksSinceSummaryRef.current = 0;
      stoppingRef.current = false;
      rateLimitedUntilRef.current = 0;

      setIsRecording(true);
      setStatus({ status: 'recording', message: 'מקליט' });
      setElapsedSeconds(0);

      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);

      intervalRef.current = window.setInterval(() => {
        flushChunks().catch(() => {});
      }, CHUNK_INTERVAL_MS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה בהפעלת ההקלטה';
      setStatus({ status: 'error', message: msg });
      setIsRecording(false);
    }
  }, [sourceMode, updateAudioLevel, flushChunks]);

  const teardownCapture = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setAudioLevel(0);
    setIsRecording(false);
  }, []);

  const stop = useCallback(() => {
    stoppingRef.current = true;
    teardownCapture();

    const leftover = pcmRecorderRef.current?.takeWavBase64() ?? null;
    if (pcmRecorderRef.current) {
      pcmRecorderRef.current.stop();
      pcmRecorderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      const mixCtx = (
        streamRef.current as MediaStream & { _mixContext?: AudioContext }
      )._mixContext;
      mixCtx?.close().catch(() => {});
      streamRef.current = null;
    }

    setStatus({ status: 'processing', message: 'מעבד את סוף ההקלטה…' });
    setIsProcessing(true);

    (async () => {
      try {
        if (leftover) {
          await transcribeBase64(leftover);
        }
        if (transcriptRef.current) {
          await runSummary(transcriptRef.current);
        }
        setStatus({ status: 'idle', message: 'ההקלטה הופסקה' });
      } catch {
        setStatus({ status: 'idle', message: 'ההקלטה הופסקה' });
      } finally {
        setIsProcessing(false);
        stoppingRef.current = false;
      }
    })();
  }, [teardownCapture, transcribeBase64, runSummary]);

  const reset = useCallback(() => {
    if (isRecording) stop();
    setTranscript('');
    setSummary('');
    setTasks([]);
    setElapsedSeconds(0);
    transcriptRef.current = '';
    chunksSinceSummaryRef.current = 0;
    setStatus({ status: 'idle', message: 'מוכן להתחלה' });
  }, [isRecording, stop]);

  const processFile = useCallback(async (file: File) => {
    if (!apiKeyRef.current.trim()) {
      setStatus({ status: 'error', message: 'נא להזין מפתח API תחילה' });
      return;
    }
    setIsProcessing(true);
    setStatus({ status: 'file-processing', message: 'מפענח קובץ שמע…' });
    try {
      const chunks = await fileToWavChunks(file);
      if (chunks.length === 0) {
        throw new Error('לא הצלחנו לפענח שמע מהקובץ');
      }
      let combined = '';
      for (let i = 0; i < chunks.length; i++) {
        setStatus({
          status: 'file-processing',
          message: `מתמלל קובץ… ${i + 1}/${chunks.length}`,
        });
        const result = await transcribeAudioChunk(
          apiKeyRef.current,
          chunks[i],
          'audio/wav',
          languageRef.current
        );
        if (result.transcript) {
          combined = combined
            ? `${combined} ${result.transcript}`
            : result.transcript;
          setTranscript(combined);
          transcriptRef.current = combined;
        }
      }
      if (combined) {
        setStatus({ status: 'file-processing', message: 'יוצר סיכום…' });
        const s = await summarizeTranscript(
          apiKeyRef.current,
          combined,
          languageRef.current
        );
        setSummary(s.summary);
        setTasks(s.tasks);
      }
      setStatus({ status: 'idle', message: 'הקובץ עובד בהצלחה' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה בעיבוד הקובץ';
      setStatus({ status: 'error', message: msg });
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const copyToClipboard = useCallback((text: string, label: string) => {
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setStatus({ status: 'idle', message: `${label} הועתק ללוח` });
        setTimeout(() => {
          setStatus({ status: 'idle', message: 'מוכן' });
        }, 2000);
      })
      .catch(() => {
        setStatus({ status: 'error', message: 'העתקה נכשלה' });
      });
  }, []);

  const copyTranscript = useCallback(
    () => copyToClipboard(transcript, 'התמלול'),
    [transcript, copyToClipboard]
  );
  const copySummary = useCallback(() => {
    const text =
      summary +
      (tasks.length > 0
        ? '\n\nמשימות:\n' +
          tasks
            .map((t, i) => `${i + 1}. ${t.task} — ${t.assignee} (${t.dueDate})`)
            .join('\n')
        : '');
    copyToClipboard(text, 'הסיכום');
  }, [summary, tasks, copyToClipboard]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (pcmRecorderRef.current) pcmRecorderRef.current.stop();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    apiKey,
    setApiKey,
    apiKeyValid,
    sourceMode,
    setSourceMode,
    language,
    setLanguage,
    isRecording,
    isProcessing,
    status,
    transcript,
    summary,
    tasks,
    elapsedSeconds,
    audioLevel,
    start,
    stop,
    reset,
    processFile,
    copyTranscript,
    copySummary,
  };
}
