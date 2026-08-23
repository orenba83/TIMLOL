import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHUNK_INTERVAL_MS,
  FIRST_CHUNK_MS,
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

const RATE_LIMIT_RETRY_MS = 30000;

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
};

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
  const firstFlushRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const transcriptRef = useRef('');
  const stoppingRef = useRef(false);
  const isRecordingRef = useRef(false);
  const queueRef = useRef<string[]>([]);
  const processingQueueRef = useRef(false);
  const rateLimitedUntilRef = useRef(0);
  const apiKeyRef = useRef(apiKey);
  const languageRef = useRef(language);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    apiKeyRef.current = apiKey;
  }, [apiKey]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const releaseWakeLock = useCallback(async () => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock) {
      try {
        await lock.release();
      } catch {
        /* already released */
      }
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: {
          request: (type: 'screen') => Promise<WakeLockSentinelLike>;
        };
      };
      if (!nav.wakeLock?.request) return;
      const lock = await nav.wakeLock.request('screen');
      wakeLockRef.current = lock;
      lock.addEventListener?.('release', () => {
        if (wakeLockRef.current === lock) wakeLockRef.current = null;
      });
    } catch {
      /* unsupported or denied — non-fatal */
    }
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        isRecordingRef.current &&
        !wakeLockRef.current
      ) {
        void requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [requestWakeLock]);

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
    }
  }, []);

  const processQueue = useCallback(async () => {
    if (processingQueueRef.current) return;
    processingQueueRef.current = true;
    setIsProcessing(true);

    try {
      while (queueRef.current.length > 0) {
        const now = Date.now();
        if (now < rateLimitedUntilRef.current) {
          const waitSec = Math.ceil(
            (rateLimitedUntilRef.current - now) / 1000
          );
          setStatus({
            status: 'recording',
            message: `ממתין לאיפוס מכסה (${waitSec}ש)…`,
          });
          break;
        }

        const base64 = queueRef.current.shift();
        if (!base64) break;

        if (!stoppingRef.current) {
          setStatus({ status: 'processing', message: 'מתמלל…' });
        }

        try {
          await transcribeBase64(base64);
          if (!stoppingRef.current) {
            setStatus({ status: 'recording', message: 'מקליט' });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'שגיאה לא ידועה';
          if (msg.includes('429')) {
            rateLimitedUntilRef.current = Date.now() + RATE_LIMIT_RETRY_MS;
            queueRef.current.unshift(base64);
            setStatus({
              status: 'recording',
              message: 'הגעת למכסה הרגעית. ממתין 30 שניות וממשיך…',
            });
            break;
          }
          setStatus({ status: 'error', message: msg });
        }
      }
    } finally {
      processingQueueRef.current = false;
      if (queueRef.current.length === 0) {
        setIsProcessing(false);
      } else if (Date.now() >= rateLimitedUntilRef.current) {
        void processQueue();
      }
    }
  }, [transcribeBase64]);

  const enqueueCurrentAudio = useCallback(() => {
    const recorder = pcmRecorderRef.current;
    if (!recorder || !recorder.hasAudio()) return;
    const base64 = recorder.takeWavBase64();
    if (!base64) return;
    queueRef.current.push(base64);
    void processQueue();
  }, [processQueue]);

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

      stoppingRef.current = false;
      rateLimitedUntilRef.current = 0;
      queueRef.current = [];

      setSummary('');
      setTasks([]);

      isRecordingRef.current = true;
      setIsRecording(true);
      setStatus({ status: 'recording', message: 'מקליט' });
      setElapsedSeconds(0);

      void requestWakeLock();

      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);

      firstFlushRef.current = window.setTimeout(() => {
        enqueueCurrentAudio();
        firstFlushRef.current = null;
      }, FIRST_CHUNK_MS);

      intervalRef.current = window.setInterval(() => {
        enqueueCurrentAudio();
      }, CHUNK_INTERVAL_MS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה בהפעלת ההקלטה';
      setStatus({ status: 'error', message: msg });
      isRecordingRef.current = false;
      setIsRecording(false);
      await releaseWakeLock();
    }
  }, [
    sourceMode,
    updateAudioLevel,
    enqueueCurrentAudio,
    requestWakeLock,
    releaseWakeLock,
  ]);

  const teardownCapture = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (firstFlushRef.current) {
      clearTimeout(firstFlushRef.current);
      firstFlushRef.current = null;
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
    isRecordingRef.current = false;
    setIsRecording(false);
  }, []);

  const stop = useCallback(() => {
    stoppingRef.current = true;
    teardownCapture();
    void releaseWakeLock();

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
          queueRef.current.push(leftover);
        }
        await processQueue();
        let guard = 0;
        while (
          (queueRef.current.length > 0 || processingQueueRef.current) &&
          guard < 200
        ) {
          await new Promise((r) => setTimeout(r, 100));
          await processQueue();
          guard += 1;
        }

        if (transcriptRef.current.trim()) {
          setStatus({ status: 'processing', message: 'יוצר סיכום דיון…' });
          const s = await summarizeTranscript(
            apiKeyRef.current,
            transcriptRef.current,
            languageRef.current
          );
          setSummary(s.summary);
          setTasks(s.tasks);
        }
        setStatus({ status: 'idle', message: 'ההקלטה הופסקה' });
      } catch {
        setStatus({ status: 'idle', message: 'ההקלטה הופסקה' });
      } finally {
        setIsProcessing(false);
        stoppingRef.current = false;
      }
    })();
  }, [teardownCapture, releaseWakeLock, processQueue]);

  const reset = useCallback(() => {
    if (isRecording) stop();
    setTranscript('');
    setSummary('');
    setTasks([]);
    setElapsedSeconds(0);
    transcriptRef.current = '';
    queueRef.current = [];
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
      if (firstFlushRef.current) clearTimeout(firstFlushRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (pcmRecorderRef.current) pcmRecorderRef.current.stop();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      void releaseWakeLock();
    };
  }, [releaseWakeLock]);

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
