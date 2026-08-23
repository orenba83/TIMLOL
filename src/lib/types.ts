export type AudioSourceMode = 'mic' | 'system' | 'both';

export type ChunkSeconds = 1 | 2 | 3;

export interface TaskItem {
  task: string;
  assignee: string;
  dueDate: string;
}

export type InsightKind = 'insight' | 'conflict';

export interface InsightItem {
  text: string;
  kind: InsightKind;
}

export interface GeminiTranscriptionResponse {
  transcript: string;
  isRealSpeech: boolean;
}

export interface GeminiSummaryResponse {
  summary: string;
  tasks: TaskItem[];
}

export interface GeminiInsightsResponse {
  insights: InsightItem[];
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
