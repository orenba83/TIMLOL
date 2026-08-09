import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHUNK_INTERVAL_MS,
  PcmRecorder,
  fileToWavBase64,
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

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

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
    const analyser = (recorder as unknown as { _analyser?: AnalyserNode })._analyser;
    if (!analyser) {
      setAudioLevel(0);
      rafRef.current = requestAnimationFrame(updateAudioLevel);
      return;
    }
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

  const start = useCallback(async () => {
    if (!apiKey.trim()) {
      setStatus({ status: 'error', message: 'נא להזין מפתח API תחילה' });
      return;
    }
    try {
      const stream = await getAudioStream(sourceMode);
      streamRef.current = stream;

      const recorder = new PcmRecorder(stream);
      const analyser = recorder.getAnalyser();
      (recorder as unknown as { _analyser?: AnalyserNode })._analyser = analyser;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, sourceMode, updateAudioLevel]);

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
      const base64 = recorder.getWavBase64();
      recorder.clear();
      const result = await transcribeAudioChunk(apiKey, base64, 'audio/wav');

      if (result.isRealSpeech && result.transcript) {
        setTranscript((prev) => {
          const addition = result.transcript;
          const next = prev ? prev + ' ' + addition : addition;
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
        summarizingRef.current = true;
        const currentTranscript = transcriptRef.current;
        if (currentTranscript) {
          summarizeTranscript(apiKey, currentTranscript)
            .then((s: GeminiSummaryResponse) => {
              setSummary(s.summary);
              setTasks(s.tasks);
            })
            .catch((err: unknown) => {
              console.error('Summary error:', err);
            })
            .finally(() => {
              summarizingRef.current = false;
            });
        } else {
          summarizingRef.current = false;
        }
      }

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
  }, [apiKey]);

  const stop = useCallback(() => {
    stoppingRef.current = true;
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
    if (pcmRecorderRef.current) {
      pcmRecorderRef.current.stop();
      pcmRecorderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setAudioLevel(0);
    setIsRecording(false);
    setStatus({ status: 'idle', message: 'ההקלטה הופסקה' });

    flushChunks()
      .then(() => {
        const current = transcriptRef.current;
        if (current) {
          return summarizeTranscript(apiKey, current).then((s) => {
            setSummary(s.summary);
            setTasks(s.tasks);
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        stoppingRef.current = false;
      });
  }, [apiKey, flushChunks]);

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

  const processFile = useCallback(
    async (file: File) => {
      if (!apiKey.trim()) {
        setStatus({ status: 'error', message: 'נא להזין מפתח API תחילה' });
        return;
      }
      setIsProcessing(true);
      setStatus({ status: 'file-processing', message: 'מעבד קובץ שמע…' });
      try {
        const base64 = await fileToWavBase64(file);
        const result = await transcribeAudioChunk(apiKey, base64, 'audio/wav');
        if (result.transcript) {
          setTranscript(result.transcript);
          transcriptRef.current = result.transcript;
        }
        const s = await summarizeTranscript(
          apiKey,
          transcriptRef.current || result.transcript
        );
        setSummary(s.summary);
        setTasks(s.tasks);
        setStatus({ status: 'idle', message: 'הקובץ עובד בהצלחה' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'שגיאה בעיבוד הקובץ';
        setStatus({ status: 'error', message: msg });
      } finally {
        setIsProcessing(false);
      }
    },
    [apiKey]
  );

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
