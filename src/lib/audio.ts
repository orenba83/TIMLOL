import type { AudioSourceMode } from './types';

export const FILE_CHUNK_SECONDS = 20;

/** Pause after speech before sending (balance live vs rate limits). */
const SILENCE_FLUSH_MS = 550;
/** Force send long continuous speech. */
const MAX_UTTERANCE_MS = 3500;
const MIN_SPEECH_MS = 400;
const MAX_BUFFER_SECONDS = 12;
const MIN_SAMPLES_SEC = 0.25;
const SPEECH_RMS = 0.015;

export function isDisplayMediaSupported(): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getDisplayMedia === 'function'
    );
  } catch {
    return false;
  }
}

export function isUserMediaSupported(): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    );
  } catch {
    return false;
  }
}

export async function getAudioStream(
  mode: AudioSourceMode
): Promise<MediaStream> {
  if (!isUserMediaSupported() && mode === 'mic') {
    throw new Error(
      'הדפדפן לא תומך בהקלטת מיקרופון. נסו Chrome/Safari מעודכן, או העלו קובץ שמע.'
    );
  }

  const micConstraints: MediaStreamConstraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  };

  if (mode === 'mic') {
    return navigator.mediaDevices.getUserMedia(micConstraints);
  }

  if (!isDisplayMediaSupported()) {
    throw new Error(
      'שמע מערכת לא זמין במכשיר/דפדפן הזה. בטלפון: השתמשו במיקרופון או העלו הקלטה. במחשב: Chrome/Edge עם Share audio.'
    );
  }

  let displayStream: MediaStream;
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      } as MediaTrackConstraints,
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'AbortError') {
      throw new Error('שיתוף המסך בוטל. נסו שוב וסמנו Share audio.');
    }
    throw new Error(
      'לא ניתן לפתוח שמע מערכת. נסו Chrome במחשב, או מיקרופון / העלאת קובץ.'
    );
  }

  const sysAudio = displayStream.getAudioTracks();
  displayStream.getVideoTracks().forEach((t) => t.stop());

  if (sysAudio.length === 0) {
    displayStream.getTracks().forEach((t) => t.stop());
    if (mode === 'system') {
      throw new Error(
        'לא נמצא שמע מערכת. בחרו "Chrome Tab" / חלון וסמנו Share audio / שתף צליל.'
      );
    }
  }

  if (mode === 'system') {
    return new MediaStream(sysAudio);
  }

  const micStream = await navigator.mediaDevices.getUserMedia(micConstraints);
  if (sysAudio.length === 0) {
    return micStream;
  }
  return mixAudioStreams([micStream, new MediaStream(sysAudio)]);
}

function mixAudioStreams(streams: MediaStream[]): MediaStream {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new Ctor();
  const dest = ctx.createMediaStreamDestination();

  for (const stream of streams) {
    if (stream.getAudioTracks().length === 0) continue;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(dest);
  }

  const mixed = dest.stream;
  (mixed as MediaStream & { _mixContext?: AudioContext })._mixContext = ctx;
  return mixed;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function floatTo16BitPCM(
  view: DataView,
  offset: number,
  input: Float32Array
): void {
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
}

export function encodeWav(
  samples: Float32Array,
  sampleRate: number
): ArrayBuffer {
  const numChannels = 1;
  const bitDepth = 16;
  const blockAlign = (numChannels * bitDepth) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * 2;
  const bufferSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  floatTo16BitPCM(view, 44, samples);

  return arrayBuffer;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

function mergeFloat32(buffers: Float32Array[]): Float32Array {
  let totalLength = 0;
  for (const b of buffers) totalLength += b.length;
  const result = new Float32Array(totalLength);
  let offset = 0;
  for (const b of buffers) {
    result.set(b, offset);
    offset += b.length;
  }
  return result;
}

function rmsOf(input: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    const v = input[i];
    sum += v * v;
  }
  return Math.sqrt(sum / Math.max(1, input.length));
}

export type SegmentHandler = (base64Wav: string) => void;

export class PcmRecorder {
  private audioContext: AudioContext;
  private source: MediaStreamAudioSourceNode;
  private processor: ScriptProcessorNode;
  private silentGain: GainNode;
  private analyser: AnalyserNode;
  private buffers: Float32Array[] = [];
  private sampleRate: number;
  private stopped = false;
  private onSegment: SegmentHandler | null;
  private speechMs = 0;
  private silenceMs = 0;
  private inSpeech = false;
  private noiseFloor = 0.004;

  constructor(stream: MediaStream, onSegment?: SegmentHandler) {
    this.onSegment = onSegment ?? null;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.audioContext = new Ctor();
    this.sampleRate = this.audioContext.sampleRate;

    this.source = this.audioContext.createMediaStreamSource(stream);
    this.processor = this.audioContext.createScriptProcessor(2048, 1, 1);
    this.silentGain = this.audioContext.createGain();
    this.silentGain.gain.value = 0;
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;

    this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (this.stopped) return;
      const input = e.inputBuffer.getChannelData(0);
      const frame = new Float32Array(input);
      this.buffers.push(frame);

      const maxSamples = Math.floor(this.sampleRate * MAX_BUFFER_SECONDS);
      let total = 0;
      for (const b of this.buffers) total += b.length;
      while (total > maxSamples && this.buffers.length > 1) {
        total -= this.buffers[0].length;
        this.buffers.shift();
      }

      const rms = rmsOf(frame);
      const frameMs = (frame.length / this.sampleRate) * 1000;
      this.noiseFloor = this.noiseFloor * 0.97 + rms * 0.03;
      const threshold = Math.max(SPEECH_RMS, this.noiseFloor * 2.8);
      const isSpeech = rms >= threshold;

      if (isSpeech) {
        this.inSpeech = true;
        this.speechMs += frameMs;
        this.silenceMs = 0;
        if (this.speechMs >= MAX_UTTERANCE_MS) {
          this.emitSegment();
        }
      } else if (this.inSpeech) {
        this.silenceMs += frameMs;
        if (
          this.silenceMs >= SILENCE_FLUSH_MS &&
          this.speechMs >= MIN_SPEECH_MS
        ) {
          this.emitSegment();
        }
      }
    };

    this.source.connect(this.analyser);
    this.source.connect(this.processor);
    this.processor.connect(this.silentGain);
    this.silentGain.connect(this.audioContext.destination);

    void this.audioContext.resume();
  }

  private emitSegment(): void {
    const base64 = this.takeWavBase64();
    this.speechMs = 0;
    this.silenceMs = 0;
    this.inSpeech = false;
    if (base64 && this.onSegment) {
      this.onSegment(base64);
    }
  }

  getAnalyser(): AnalyserNode {
    return this.analyser;
  }

  takeWavBase64(): string | null {
    if (this.buffers.length === 0) return null;
    const samples = mergeFloat32(this.buffers);
    this.buffers = [];
    if (samples.length < this.sampleRate * MIN_SAMPLES_SEC) return null;
    const wav = encodeWav(samples, this.sampleRate);
    return arrayBufferToBase64(wav);
  }

  hasAudio(): boolean {
    return this.buffers.length > 0;
  }

  stop(): void {
    this.stopped = true;
    try {
      this.processor.disconnect();
      this.silentGain.disconnect();
      this.source.disconnect();
    } catch {
      /* already disconnected */
    }
    this.audioContext.close().catch(() => {});
  }
}

export async function fileToWavChunks(
  file: File,
  chunkSeconds = FILE_CHUNK_SECONDS
): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new Ctor();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    const rate = audioBuffer.sampleRate;
    const frameSize = Math.floor(rate * chunkSeconds);
    const chunks: string[] = [];
    for (let start = 0; start < channelData.length; start += frameSize) {
      const slice = channelData.subarray(
        start,
        Math.min(start + frameSize, channelData.length)
      );
      if (slice.length < rate * 0.3) continue;
      const wav = encodeWav(new Float32Array(slice), rate);
      chunks.push(arrayBufferToBase64(wav));
    }
    return chunks;
  } finally {
    ctx.close().catch(() => {});
  }
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
