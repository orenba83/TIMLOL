import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PcmRecorder,
  fileToWavChunks,
  getAudioStream,
} from '@/lib/audio';
import {
  extractLiveInsights,
  summarizeTranscript,
  transcribeAudioChunk,
  validateApiKey,
} from '@/lib/gemini';
import type {
  AudioSourceMode,
  InsightItem,
  RecordingStatus,
  TaskItem,
} from '@/lib/types';

interface UseMeetingRecorderResult {
  apiKey: string;
  setApiKey: (key: string) => void;
  apiKeyValid: boolean | null;
  sourceMode: AudioSourceMode;
  setSourceMode: (m: AudioSourceMode) => void;
  isRecording: boolean;
  isProcessing: boolean;
  status: RecordingStatus;
  transcript: string;
  insights: InsightItem[];
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
  copyInsights: () => void;
}

const RATE_LIMIT_RETRY_MS = 45000;
/** One request at a time avoids free-tier 429 storms. */
const MAX_PARALLEL = 1;
const MAX_QUEUE = 4;
const INSIGHTS_EVERY_SEGMENTS = 8;

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
};

type QueueItem = { id: number; base64: string };

export function useMeetingRecorder(
  initialApiKey: string
): UseMeetingRecorderResult {
  const [apiKey, setApiKeyState] = useState(initialApiKey);
  const [apiKeyValid, setApiKeyValid] = useState<boolean | null>(null);
  const [sourceMode, setSourceMode] = useState<AudioSourceMode>('mic');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<RecordingStatus>({
    status: 'idle',
    message: 'מוכן להתחלה',
  });
  const [transcript, setTranscript] = useState('');
  const [insights, setInsights] = useState<InsightItem[]>([]);
  const [summary, setSummary] = useState('');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);

  const pcmRecorderRef = useRef<PcmRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const rateRetryRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const transcriptRef = useRef('');
  const stoppingRef = useRef(false);
  const isRecordingRef = useRef(false);
  const queueRef = useRef<QueueItem[]>([]);
  const inFlightRef = useRef(0);
  const nextIdRef = useRef(0);
  const nextAppendIdRef = useRef(0);
  const pendingTextRef = useRef<Map<number, string>>(new Map());
  const rateLimitedUntilRef = useRef(0);
  const apiKeyRef = useRef(apiKey);
  const segmentsSinceInsightsRef = useRef(0);
  const insightsBusyRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const pumpRef = useRef<() => void>(() => {});

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    apiKeyRef.current = apiKey;
  }, [apiKey]);

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
      /* unsupported */
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

  const refreshInsights = useCallback(async () => {
    if (insightsBusyRef.current || stoppingRef.current) return;
    if (Date.now() < rateLimitedUntilRef.current) return;
    const text = transcriptRef.current.trim();
    if (text.length < 50) return;
    insightsBusyRef.current = true;
    try {
      const res = await extractLiveInsights(apiKeyRef.current, text);
      if (!stoppingRef.current) {
        setInsights(res.insights);
      }
    } catch (err) {
      console.error('Insights error:', err);
    } finally {
      insightsBusyRef.current = false;
    }
  }, []);

  const flushPendingInOrder = useCallback(() => {
    while (pendingTextRef.current.has(nextAppendIdRef.current)) {
      const piece = pendingTextRef.current.get(nextAppendIdRef.current) || '';
      pendingTextRef.current.delete(nextAppendIdRef.current);
      nextAppendIdRef.current += 1;
      if (!piece) continue;
      setTranscript((prev) => {
        const next = prev ? `${prev} ${piece}` : piece;
        transcriptRef.current = next;
        return next;
      });
      segmentsSinceInsightsRef.current += 1;
      if (segmentsSinceInsightsRef.current >= INSIGHTS_EVERY_SEGMENTS) {
        segmentsSinceInsightsRef.current = 0;
        void refreshInsights();
      }
    }
  }, [refreshInsights]);

  const scheduleRateLimitRetry = useCallback(() => {
    if (rateRetryRef.current) {
      clearTimeout(rateRetryRef.current);
      rateRetryRef.current = null;
    }
    const wait = Math.max(0, rateLimitedUntilRef.current - Date.now()) + 50;
    rateRetryRef.current = window.setTimeout(() => {
      rateRetryRef.current = null;
      rateLimitedUntilRef.current = 0;
      if (!stoppingRef.current && isRecordingRef.current) {
        setStatus({ status: 'recording', message: 'מקליט · ממשיך תמלול' });
      }
      pumpRef.current();
    }, wait);
  }, []);

  const pumpQueue = useCallback(() => {
    const now = Date.now();
    if (now < rateLimitedUntilRef.current) {
      const waitSec = Math.ceil((rateLimitedUntilRef.current - now) / 1000);
      if (!stoppingRef.current) {
        setStatus({
          status: 'recording',
          message: `מכסת API מלאה — ממשיך אוטומטית בעוד ${waitSec}ש (ההקלטה נמשכת)`,
        });
      }
      scheduleRateLimitRetry();
      return;
    }

    while (
      inFlightRef.current < MAX_PARALLEL &&
      queueRef.current.length > 0 &&
      Date.now() >= rateLimitedUntilRef.current
    ) {
      const item = queueRef.current.shift();
      if (!item) break;

      inFlightRef.current += 1;
      setIsProcessing(true);
      if (!stoppingRef.current) {
        setStatus({ status: 'recording', message: 'מקליט · מתמלל' });
      }

      void (async () => {
        try {
          const result = await transcribeAudioChunk(
            apiKeyRef.current,
            item.base64,
            'audio/wav'
          );
          const text =
            result.isRealSpeech && result.transcript
              ? result.transcript.trim()
              : '';
          pendingTextRef.current.set(item.id, text);
          flushPendingInOrder();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'שגיאה לא ידועה';
          if (msg.includes('429') || msg.includes('Resource exhausted')) {
            rateLimitedUntilRef.current = Date.now() + RATE_LIMIT_RETRY_MS;
            queueRef.current.unshift(item);
            if (queueRef.current.length > MAX_QUEUE) {
              queueRef.current = queueRef.current.slice(0, MAX_QUEUE);
            }
            if (!stoppingRef.current) {
              setStatus({
                status: 'recording',
                message:
                  'מכסת Gemini מלאה — ממשיך אוטומטית בעוד כ־45ש (ההקלטה נמשכת)',
              });
            }
            scheduleRateLimitRetry();
            // Do NOT mark pending empty — keeps order and retries same item
          } else {
            if (!stoppingRef.current) {
              setStatus({ status: 'error', message: msg });
            }
            pendingTextRef.current.set(item.id, '');
            flushPendingInOrder();
          }
        } finally {
          inFlightRef.current -= 1;
          if (inFlightRef.current === 0 && queueRef.current.length === 0) {
            setIsProcessing(false);
            if (
              !stoppingRef.current &&
              isRecordingRef.current &&
              Date.now() >= rateLimitedUntilRef.current
            ) {
              setStatus({ status: 'recording', message: 'מקליט' });
            }
          }
          if (Date.now() >= rateLimitedUntilRef.current) {
            pumpRef.current();
          }
        }
      })();
    }
  }, [flushPendingInOrder, scheduleRateLimitRetry]);

  useEffect(() => {
    pumpRef.current = pumpQueue;
  }, [pumpQueue]);

  const enqueueSegment = useCallback((base64: string) => {
    const id = nextIdRef.current++;
    queueRef.current.push({ id, base64 });
    while (queueRef.current.length > MAX_QUEUE) {
      const dropped = queueRef.current.shift();
      if (dropped) {
        pendingTextRef.current.set(dropped.id, '');
        flushPendingInOrder();
      }
    }
    pumpRef.current();
  }, [flushPendingInOrder]);

  const start = useCallback(async () => {
    if (!apiKeyRef.current.trim()) {
      setStatus({ status: 'error', message: 'נא להזין מפתח API תחילה' });
      return;
    }
    try {
      const stream = await getAudioStream(sourceMode);
      streamRef.current = stream;

      const recorder = new PcmRecorder(stream, (base64) => {
        enqueueSegment(base64);
      });
      pcmRecorderRef.current = recorder;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateAudioLevel);

      stoppingRef.current = false;
      rateLimitedUntilRef.current = 0;
      if (rateRetryRef.current) {
        clearTimeout(rateRetryRef.current);
        rateRetryRef.current = null;
      }
      queueRef.current = [];
      pendingTextRef.current.clear();
      nextIdRef.current = 0;
      nextAppendIdRef.current = 0;
      inFlightRef.current = 0;
      segmentsSinceInsightsRef.current = 0;

      setSummary('');
      setTasks([]);
      setInsights([]);

      isRecordingRef.current = true;
      setIsRecording(true);
      setStatus({ status: 'recording', message: 'מקליט' });
      setElapsedSeconds(0);

      void requestWakeLock();

      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה בהפעלת ההקלטה';
      setStatus({ status: 'error', message: msg });
      isRecordingRef.current = false;
      setIsRecording(false);
      await releaseWakeLock();
    }
  }, [sourceMode, updateAudioLevel, enqueueSegment, requestWakeLock, releaseWakeLock]);

  const teardownCapture = useCallback(() => {
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

  const waitForQueueDrain = useCallback(async () => {
    let guard = 0;
    while (
      (queueRef.current.length > 0 || inFlightRef.current > 0) &&
      guard < 400
    ) {
      pumpRef.current();
      await new Promise((r) => setTimeout(r, 150));
      guard += 1;
    }
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
          enqueueSegment(leftover);
        }
        await waitForQueueDrain();

        setInsights([]);

        if (transcriptRef.current.trim()) {
          setStatus({ status: 'processing', message: 'יוצר סיכום דיון…' });
          const s = await summarizeTranscript(
            apiKeyRef.current,
            transcriptRef.current
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
  }, [teardownCapture, releaseWakeLock, enqueueSegment, waitForQueueDrain]);

  const reset = useCallback(() => {
    if (isRecording) stop();
    setTranscript('');
    setSummary('');
    setTasks([]);
    setInsights([]);
    setElapsedSeconds(0);
    transcriptRef.current = '';
    queueRef.current = [];
    pendingTextRef.current.clear();
    setStatus({ status: 'idle', message: 'מוכן להתחלה' });
  }, [isRecording, stop]);

  const processFile = useCallback(async (file: File) => {
    if (!apiKeyRef.current.trim()) {
      setStatus({ status: 'error', message: 'נא להזין מפתח API תחילה' });
      return;
    }
    setIsProcessing(true);
    setInsights([]);
    setSummary('');
    setTasks([]);
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
          'audio/wav'
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
        const s = await summarizeTranscript(apiKeyRef.current, combined);
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
  const copyInsights = useCallback(() => {
    const text = insights
      .map((i) => `${i.kind === 'conflict' ? '[בירור] ' : ''}${i.text}`)
      .join('\n');
    copyToClipboard(text, 'התובנות');
  }, [insights, copyToClipboard]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (rateRetryRef.current) clearTimeout(rateRetryRef.current);
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
    isRecording,
    isProcessing,
    status,
    transcript,
    insights,
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
    copyInsights,
  };
}
