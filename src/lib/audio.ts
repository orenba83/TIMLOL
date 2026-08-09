import type { AudioSourceMode } from './types';

export const CHUNK_INTERVAL_MS = 15000;

export function getSupportedMimeType(): string {
  return 'audio/wav';
}

export async function getAudioStream(
  mode: AudioSourceMode
): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  };

  if (mode === 'mic') {
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  if (mode === 'system') {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      } as MediaTrackConstraints,
    });
    const audioTracks = displayStream.getAudioTracks();
    if (audioTracks.length === 0) {
      displayStream.getTracks().forEach((t) => t.stop());
      throw new Error(
        'לא נמצא שמע מערכת. ודאו שבחרת לשתף עם צליל/אודיו בעת שיתוף המסך.'
      );
    }
    const audioOnly = new MediaStream(audioTracks);
    displayStream.getVideoTracks().forEach((t) => t.stop());
    return audioOnly;
  }

  // both: mic + system
  const micStream = await navigator.mediaDevices.getUserMedia(constraints);
  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      } as MediaTrackConstraints,
    });
    const sysAudio = displayStream.getAudioTracks();
    if (sysAudio.length === 0) {
      displayStream.getTracks().forEach((t) => t.stop());
      return micStream;
    }
    const combined = new MediaStream([
      ...micStream.getAudioTracks(),
      ...sysAudio,
    ]);
    displayStream.getVideoTracks().forEach((t) => t.stop());
    return combined;
  } catch {
    return micStream;
  }
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

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
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

export class PcmRecorder {
  private audioContext: AudioContext;
  private source: MediaStreamAudioSourceNode;
  private processor: ScriptProcessorNode;
  private silentGain: GainNode;
  private buffers: Float32Array[] = [];
  private sampleRate: number;

  constructor(stream: MediaStream) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.audioContext = new Ctor();
    this.sampleRate = this.audioContext.sampleRate;

    this.source = this.audioContext.createMediaStreamSource(stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.silentGain = this.audioContext.createGain();
    this.silentGain.gain.value = 0;

    this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
      const input = e.inputBuffer.getChannelData(0);
      this.buffers.push(new Float32Array(input));
    };

    // ScriptProcessor requires connection to destination to fire onaudioprocess
    // Route through a silent gain node to avoid audio feedback
    this.source.connect(this.processor);
    this.processor.connect(this.silentGain);
    this.silentGain.connect(this.audioContext.destination);
  }

  getAnalyser(): AnalyserNode {
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 2048;
    this.source.connect(analyser);
    return analyser;
  }

  getWavBase64(): string {
    const samples = mergeFloat32(this.buffers);
    const wav = encodeWav(samples, this.sampleRate);
    return arrayBufferToBase64(wav);
  }

  hasAudio(): boolean {
    return this.buffers.length > 0;
  }

  clear(): void {
    this.buffers = [];
  }

  stop(): void {
    this.processor.disconnect();
    this.silentGain.disconnect();
    this.source.disconnect();
    this.audioContext.close().catch(() => {});
  }
}

export async function fileToWavBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new Ctor();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    const wav = encodeWav(channelData, audioBuffer.sampleRate);
    return arrayBufferToBase64(wav);
  } finally {
    ctx.close().catch(() => {});
  }
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
