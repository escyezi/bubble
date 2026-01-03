import type { Conversation, Emotion, Message, MessageSegment } from "./types";

export function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function newConversation(): Conversation {
  return {
    id: newId(),
    messages: [],
    updatedAt: Date.now(),
  };
}

export function updateAssistant(
  convo: Conversation,
  messageId: string,
  update: (msg: Message) => Message,
): Conversation {
  const idx = convo.messages.findIndex(m => m.id === messageId);
  if (idx === -1) return convo;
  const current = convo.messages[idx];
  if (!current || current.role !== "assistant") return convo;
  const messages = convo.messages.slice();
  messages[idx] = update(current);
  return { ...convo, messages, updatedAt: Date.now() };
}

export function appendToSegments(
  segments: MessageSegment[],
  emotion: Emotion,
  text: string,
): MessageSegment[] {
  if (!text) return segments;
  const last = segments[segments.length - 1];
  if (last && last.emotion === emotion) {
    const next = segments.slice();
    next[next.length - 1] = { ...last, text: `${last.text}${text}` };
    return next;
  }
  return [...segments, { text, emotion }];
}

export function takeChars(input: string, maxChars: number) {
  if (!input) return { taken: "", rest: "", count: 0 };
  let taken = "";
  let count = 0;
  for (const ch of input) {
    taken += ch;
    count++;
    if (count >= maxChars) break;
  }
  return { taken, rest: input.slice(taken.length), count };
}

export function computeDelayMs(ch: string, baseMs: number) {
  if (!ch) return baseMs;
  if (ch === "\n") return baseMs + 220;

  if (/[,，]/.test(ch)) return baseMs + 70;
  if (/[。.!?！？]/.test(ch)) return baseMs + 120;
  if (/[;；:：]/.test(ch)) return baseMs + 90;
  if (/[…]/.test(ch)) return baseMs + 160;

  return baseMs;
}
