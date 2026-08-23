export type AudioSourceMode = 'mic' | 'system' | 'both';

export type LanguageMode = 'auto' | 'he' | 'en';

export interface TaskItem {
  task: string;
  assignee: string;
  dueDate: string;
}

export interface GeminiTranscriptionResponse {
  transcript: string;
  isRealSpeech: boolean;
}

export interface GeminiSummaryResponse {
  summary: string;
  tasks: TaskItem[];
}

export type Status =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'error'
  | 'file-processing';

export interface RecordingStatus {
  status: Status;
  message: string;
}
