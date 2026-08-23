import type {
  GeminiTranscriptionResponse,
  GeminiSummaryResponse,
  GeminiInsightsResponse,
  InsightItem,
  TaskItem,
} from './types';

const PRIMARY_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODELS = [
  'gemini-2.0-flash',
  'gemini-3-flash-preview',
  'gemini-3.5-flash',
];

const LANGUAGE_RULE = `The meeting is only Hebrew and/or English (including code-switching in the same sentence).
Never treat the audio as another language. Transcribe exactly as spoken.
Do not translate. Hebrew stays Hebrew, English stays English.`;

function transcriptionPrompt(): string {
  return `You are a real-time meeting transcription engine for Hebrew and English only.
The audio is a short chunk from a live discussion.

${LANGUAGE_RULE}

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

function insightsPrompt(): string {
  return `אתה עוזר חי לדיון מקצועי בעברית ו/או אנגלית.
קיבלת את התמלול עד עכשיו (לא את כל הדיון).

הפק רשימת תובנות קצרה לשימוש תוך כדי השיחה.

כללים:
1. insights: 2–6 נקודות קצרות. מה חשוב עכשיו? מה כדאי לחדד?
2. kind="conflict" רק אם:
   - שני דוברים סותרים זה את זה, או
   - מישהו טוען עובדה שנשמעת שגויה / לא עקבית (למשל: "בתקן יש 7 פריטים" כשבדיון או בידע כללי נראה שיש 8).
   סמן כבירור, לא כפסק דין. אל תמציא קונפליקט אם אין רמז.
3. kind="insight" לשאר: החלטות מתגבשות, פערי מידע, נקודה מעניינת לדיון.
4. אם הדיון שגרתי ואין מחלוקת — החזר תובנות רגילות בלבד, בלי conflicts.
5. כתוב בעברית, מונחים טכניים באנגלית יישארו באנגלית.
6. אל תסכם את כל הפגישה. זה לא סיכום סיום.

השב רק JSON:
{"insights":[{"kind":"insight","text":"..."},{"kind":"conflict","text":"..."}]}`;
}

function summaryPrompt(): string {
  return `אתה מומחה לסיכום פגישות ודיונים בעברית ו/או אנגלית.
כתוב את הסיכום ואת תיאורי המשימות בעברית. מונחים טכניים באנגלית יישארו באנגלית.

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
  mimeType: string
): Promise<GeminiTranscriptionResponse> {
  const candidate = await callGemini(
    apiKey,
    transcriptionPrompt(),
    [audioPart(base64Audio, mimeType)],
    512
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

export async function extractLiveInsights(
  apiKey: string,
  transcript: string
): Promise<GeminiInsightsResponse> {
  if (!transcript.trim()) {
    return { insights: [] };
  }
  const candidate = await callGemini(
    apiKey,
    insightsPrompt(),
    [{ text: `תמלול עד כה:\n${transcript.slice(-8000)}` }],
    1024
  );
  const text = extractText(candidate);
  const parsed = tryParseJson(text) as GeminiInsightsResponse | null;
  if (!parsed || !Array.isArray(parsed.insights)) {
    return { insights: [] };
  }
  const insights: InsightItem[] = parsed.insights
    .filter((i) => i && typeof i.text === 'string' && i.text.trim())
    .map((i) => ({
      text: i.text.trim(),
      kind: i.kind === 'conflict' ? 'conflict' : 'insight',
    }));
  return { insights };
}

export async function summarizeTranscript(
  apiKey: string,
  transcript: string
): Promise<GeminiSummaryResponse> {
  if (!transcript.trim()) {
    return { summary: '', tasks: [] };
  }
  const candidate = await callGemini(
    apiKey,
    summaryPrompt(),
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
