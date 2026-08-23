import type {
  GeminiTranscriptionResponse,
  GeminiSummaryResponse,
  LanguageMode,
  TaskItem,
} from './types';

const PRIMARY_MODEL = 'gemini-3-flash-preview';
const FALLBACK_MODELS = [
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

function languageInstructions(mode: LanguageMode): string {
  switch (mode) {
    case 'he':
      return `The speech is primarily Hebrew (including Israeli Hebrew slang and workplace phrasing).
Transcribe in Hebrew. Keep English words, product names, and code identifiers exactly as spoken.`;
    case 'en':
      return `The speech is primarily English.
Transcribe in English. Keep Hebrew words or names exactly as spoken if they appear.`;
    default:
      return `The meeting may be Hebrew-only, English-only, or mixed in the SAME sentence
(code-switching: Hebrew discussion with English technical terms, or vice versa).
Transcribe exactly as spoken. Do not translate. Preserve original script for each word
(Hebrew letters stay Hebrew, Latin letters stay Latin).`;
  }
}

function transcriptionPrompt(mode: LanguageMode): string {
  return `You are a real-time meeting transcription engine for Hebrew and English.
The audio is a short chunk from a live discussion.

${languageInstructions(mode)}

Rules:
1. Transcribe ONLY speech that is actually in this chunk.
2. If silent, noise-only, or no clear human speech: empty transcript and isRealSpeech=false.
3. NEVER invent or guess words. If unsure there is speech, return empty.
4. No speaker labels, timestamps, or commentary — raw words only.
5. Keep punctuation light and natural. Do not "correct" code-switching.

Respond with ONLY this JSON:
{"transcript": "the transcribed text", "isRealSpeech": true}
If no speech:
{"transcript": "", "isRealSpeech": false}`;
}

function summaryPrompt(mode: LanguageMode): string {
  const langLine =
    mode === 'en'
      ? 'Write the summary and task descriptions in English. Keep Hebrew names as-is.'
      : 'כתוב את הסיכום ואת תיאורי המשימות בעברית. מונחים טכניים באנגלית יישארו באנגלית.';

  return `אתה מומחה לסיכום פגישות ודיונים.
התמלול עשוי להיות בעברית, באנגלית, או משולב באותו משפט.
${langLine}

הפק:
1. "summary": סיכום תמציתי של עיקרי ההחלטות ונקודות הדיון (2-4 פסקאות קצרות).
2. "tasks": מערך משימות. לכל משימה: "task", "assignee" (אם לא הוזכר: "לא צוין"), "dueDate" (אם לא הוזכר: "לא צוין").
אם אין פעולות ברורות, החזר tasks ריק.

השב רק ב-JSON:
{"summary": "...", "tasks": [{"task": "...", "assignee": "...", "dueDate": "..."}]}`;
}

async function callGeminiOnce(
  apiKey: string,
  model: string,
  systemPrompt: string,
  parts: Array<Record<string, unknown>>,
  maxOutputTokens: number
): Promise<unknown> {
  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.1,
      topP: 0.9,
      maxOutputTokens,
      responseMimeType: 'application/json',
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Gemini API error ${res.status}: ${text}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  if (!candidate) {
    if (data?.promptFeedback?.blockReason) {
      throw new Error(`Request blocked: ${data.promptFeedback.blockReason}`);
    }
    throw new Error('Gemini returned no candidates');
  }
  return candidate;
}

let resolvedModel: string | null = null;

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  parts: Array<Record<string, unknown>>,
  maxOutputTokens = 2048
): Promise<unknown> {
  const models = resolvedModel
    ? [resolvedModel, ...FALLBACK_MODELS.filter((m) => m !== resolvedModel)]
    : [PRIMARY_MODEL, ...FALLBACK_MODELS];

  let lastError: unknown = null;
  for (const model of models) {
    try {
      const candidate = await callGeminiOnce(
        apiKey,
        model,
        systemPrompt,
        parts,
        maxOutputTokens
      );
      resolvedModel = model;
      return candidate;
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      if (status === 404 || status === 400) {
        continue;
      }
      throw err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('All Gemini models failed');
}

function extractText(candidate: unknown): string {
  const content = (
    candidate as { content?: { parts?: Array<{ text?: string }> } }
  )?.content;
  const parts = content?.parts;
  if (!parts) return '';
  return parts.map((p) => p.text || '').join('');
}

function audioPart(base64: string, mimeType: string) {
  return {
    inlineData: { mimeType, data: base64 },
  };
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function transcribeAudioChunk(
  apiKey: string,
  base64Audio: string,
  mimeType: string,
  language: LanguageMode = 'auto'
): Promise<GeminiTranscriptionResponse> {
  const candidate = await callGemini(
    apiKey,
    transcriptionPrompt(language),
    [audioPart(base64Audio, mimeType)],
    1024
  );
  const text = extractText(candidate);
  const parsed = tryParseJson(text) as GeminiTranscriptionResponse | null;
  if (parsed) {
    return {
      transcript: parsed.transcript?.trim() || '',
      isRealSpeech: !!parsed.isRealSpeech,
    };
  }
  return { transcript: text.trim(), isRealSpeech: text.trim().length > 0 };
}

export async function summarizeTranscript(
  apiKey: string,
  transcript: string,
  language: LanguageMode = 'auto'
): Promise<GeminiSummaryResponse> {
  if (!transcript.trim()) {
    return { summary: '', tasks: [] };
  }
  const candidate = await callGemini(
    apiKey,
    summaryPrompt(language),
    [{ text: `תמלול:\n${transcript}` }],
    4096
  );
  const text = extractText(candidate);
  const parsed = tryParseJson(text) as GeminiSummaryResponse | null;
  if (parsed) {
    return {
      summary: parsed.summary?.trim() || '',
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    };
  }
  return { summary: text.trim(), tasks: [] };
}

export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    return res.ok;
  } catch {
    return false;
  }
}

export type { TaskItem };
