import type {
  GeminiTranscriptionResponse,
  GeminiSummaryResponse,
  TaskItem,
} from './types';

const TRANSCRIPTION_MODEL = 'gemini-3-flash-preview';
const SUMMARY_MODEL = 'gemini-3-flash-preview';

const TRANSCRIPTION_PROMPT = `You are a real-time meeting transcription engine specialized in Hebrew and English.
The audio is a short chunk (a few seconds) from a live meeting.
Your job:
1. Transcribe ONLY the speech actually present in this audio chunk.
2. The meeting may be in Hebrew, English, or mixed (Hebrew with English technical terms). Transcribe exactly as spoken, preserving the original language and any code-switching.
3. If the audio is silent, contains only noise, or has no clear human speech, return an EMPTY transcript and set isRealSpeech to false.
4. NEVER invent, guess, or hallucinate text. If you are not certain there is speech, return empty.
5. Do not add speaker labels, timestamps, or commentary — only the raw transcribed words.

Respond with ONLY a JSON object in this exact format, nothing else:
{"transcript": "the transcribed text", "isRealSpeech": true}
If no speech, respond with: {"transcript": "", "isRealSpeech": false}`;

const SUMMARY_PROMPT = `אתה מומחה לסיכום פגישות ודיונים.
בהתבסס על התמלול שיופיע להלן (שעשוי להיות בעברית, באנגלית, או משולב), עליך לייצר:
1. "summary": סיכום תמציתי בעברית של עיקרי ההחלטות ונקודות הדיון (2-4 פסקאות קצרות). הסיכום חייב להיות בעברית תמיד, גם אם התמלול באנגלית. מונחים טכניים באנגלית יישארו בלעזית בתוך הטקסט העברי.
2. "tasks": מערך של פריטי משימה. לכל משימה: "task" (תיאור המשימה בעברית), "assignee" (האחראי — יופק מתוך השיחה; אם לא הוזכר, השתמש ב"לא צוין"), "dueDate" (תאריך יעד שהוזכר, או "לא צוין" אם לא).
אם אין פריטי פעולה ברורים, החזר מערך tasks ריק.

השב אך ורק באובייקט JSON בלבד בפורמט הבא:
{"summary": "...", "tasks": [{"task": "...", "assignee": "...", "dueDate": "..."}]}`;

async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  parts: Array<Record<string, unknown>>
): Promise<unknown> {
  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.1,
      topP: 0.9,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
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
    throw new Error(`Gemini API error ${res.status}: ${text}`);
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
    TRANSCRIPTION_MODEL,
    TRANSCRIPTION_PROMPT,
    [audioPart(base64Audio, mimeType)]
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
  transcript: string
): Promise<GeminiSummaryResponse> {
  if (!transcript.trim()) {
    return { summary: '', tasks: [] };
  }
  const candidate = await callGemini(
    apiKey,
    SUMMARY_MODEL,
    SUMMARY_PROMPT,
    [{ text: `תמלול:\n${transcript}` }]
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
