import { buildEmotionTagInstruction } from "./emotionTags";
import type { Message, Settings } from "./types";

export type OpenAIResult = {
  rawText: string;
};

export type OpenAIStreamHandlers = {
  onDeltaText: (deltaText: string) => void;
  onDone?: () => void;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return "https://api.openai.com/v1";
  return trimmed.replace(/\/+$/, "");
}

export async function callOpenAIChat(settings: Settings, messages: Message[]): Promise<OpenAIResult> {
  if (!settings.openaiKey.trim()) {
    throw new Error("Missing OpenAI key. Please open Settings and fill it in.");
  }

  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const url = `${baseUrl}/chat/completions`;

  const payload = {
    model: settings.model || "gpt-4o-mini",
    messages: toOpenAIMessages(messages),
    temperature: 0.7,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.openaiKey.trim()}`,
    },
    body: JSON.stringify(payload),
  });

  const data = (await res.json().catch(() => null)) as ChatCompletionResponse | null;
  if (!res.ok) {
    const detail = data?.error?.message ? `: ${data.error.message}` : "";
    throw new Error(`OpenAI request failed (${res.status})${detail}`);
  }

  const text = data?.choices?.[0]?.message?.content ?? "";
  return { rawText: text };
}

export async function streamOpenAIChat(
  settings: Settings,
  messages: Message[],
  handlers: OpenAIStreamHandlers,
  signal?: AbortSignal,
): Promise<OpenAIResult> {
  if (!settings.openaiKey.trim()) {
    throw new Error("Missing OpenAI key. Please open Settings and fill it in.");
  }

  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const url = `${baseUrl}/chat/completions`;

  const payload = {
    model: settings.model || "gpt-4o-mini",
    messages: toOpenAIMessages(messages),
    temperature: 0.7,
    stream: true,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.openaiKey.trim()}`,
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as ChatCompletionResponse | null;
    const detail = data?.error?.message ? `: ${data.error.message}` : "";
    throw new Error(`OpenAI request failed (${res.status})${detail}`);
  }

  const body = res.body;
  if (!body) {
    // Some environments don't expose a readable stream.
    const { rawText } = await callOpenAIChat(settings, messages);
    if (rawText) handlers.onDeltaText(rawText);
    handlers.onDone?.();
    return { rawText };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();

  let sseBuffer = "";
  let rawText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    // Normalize CRLF to LF for simpler SSE parsing.
    if (sseBuffer.includes("\r\n")) sseBuffer = sseBuffer.replace(/\r\n/g, "\n");

    let boundary = sseBuffer.indexOf("\n\n");
    while (boundary !== -1) {
      const eventBlock = sseBuffer.slice(0, boundary);
      sseBuffer = sseBuffer.slice(boundary + 2);
      boundary = sseBuffer.indexOf("\n\n");

      const dataLines = eventBlock
        .split("\n")
        .map(l => l.trimEnd())
        .filter(l => l.startsWith("data:"))
        .map(l => l.replace(/^data:\s?/, ""));

      for (const dataLine of dataLines) {
        if (dataLine === "[DONE]") {
          handlers.onDone?.();
          return { rawText };
        }

        const json = safeJsonParse(dataLine);
        const delta = json?.choices?.[0]?.delta?.content;
        if (typeof delta !== "string") continue;

        rawText += delta;
        handlers.onDeltaText(delta);
      }
    }
  }

  handlers.onDone?.();
  return { rawText };
}

function safeJsonParse(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = [
  "You are Bubble, a friendly companion assistant. Reply concisely.",
  "Output plain text only (no JSON, no markdown).",
  "Embed emotion tags inline to control the avatar emotion.",
  buildEmotionTagInstruction(),
].join(" ");

function toOpenAIMessages(messages: Message[]) {
  const system = {
    role: "system" as const,
    content: SYSTEM_PROMPT,
  };
  return [
    system,
    ...messages.map(m => ({
      role: m.role,
      content: m.text,
    })),
  ];
}
