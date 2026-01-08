import { TYPING_BASE_MS } from "../constants";
import {
  appendToSegments,
  computeDelayMs,
  newId,
  takeChars,
  updateAssistant,
} from "../chatUtils";
import { inferEmotionFromText } from "../emotion";
import { createEmotionTagParser, stripEmotionTags } from "../emotionTags";
import { streamOpenAIChat } from "../openai";
import type { Emotion, Message } from "../types";
import { bubbleState } from "./state";
import { reportGlobalError } from "./errors";

type PendingOp = { type: "text"; text: string } | { type: "emotion"; emotion: Emotion };

let abortController: AbortController | null = null;
let typingTimer: number | null = null;
let pendingOps: PendingOp[] = [];
let typingEmotion: Emotion = "neutral";
let activeAssistantId: string | null = null;
let parser: ReturnType<typeof createEmotionTagParser> | null = null;

export function cleanupRuntime() {
  abortController?.abort();
  abortController = null;

  if (typingTimer) window.clearTimeout(typingTimer);
  typingTimer = null;
  pendingOps = [];
  typingEmotion = "neutral";
  activeAssistantId = null;
  parser = null;
  bubbleState.isSending = false;
  bubbleState.errorText = null;
}

export async function sendTextRuntime(text: string) {
  if (!text.trim()) return;

  bubbleState.errorText = null;
  bubbleState.isSending = true;

  abortController?.abort();
  abortController = new AbortController();

  if (typingTimer) window.clearTimeout(typingTimer);
  typingTimer = null;
  pendingOps = [];
  typingEmotion = "neutral";
  parser = createEmotionTagParser();

  const userMessage: Message = {
    id: newId(),
    role: "user",
    text,
    createdAt: Date.now(),
    emotion: "neutral",
  };

  const nextConversation = {
    ...bubbleState.conversation,
    title: bubbleState.conversation.title ?? text.slice(0, 24),
    messages: [...bubbleState.conversation.messages, userMessage],
    updatedAt: Date.now(),
  };

  const assistantMessageId = newId();
  activeAssistantId = assistantMessageId;
  const assistantPlaceholder: Message = {
    id: assistantMessageId,
    role: "assistant",
    text: "",
    rawText: "",
    createdAt: Date.now(),
    emotion: "thinking",
    segments: [],
  };

  bubbleState.conversation = {
    ...nextConversation,
    messages: [...nextConversation.messages, assistantPlaceholder],
    updatedAt: Date.now(),
  };
  bubbleState.composerText = "";

  try {
    if (!parser) throw new Error("Parser not ready");

    const { rawText } = await streamOpenAIChat(
      bubbleState.settings,
      nextConversation.messages,
      {
        onDeltaText: deltaText => {
          const events = parser?.push(deltaText) ?? [];
          for (const ev of events) {
            if (ev.type === "text") enqueueOp({ type: "text", text: ev.text });
            else enqueueOp({ type: "emotion", emotion: ev.emotion });
          }
        },
      },
      abortController.signal,
    );

    const tailEvents = parser.flush();
    for (const ev of tailEvents) {
      if (ev.type === "text") enqueueOp({ type: "text", text: ev.text });
      if (ev.type === "emotion") enqueueOp({ type: "emotion", emotion: ev.emotion });
    }

    bubbleState.conversation = updateAssistant(bubbleState.conversation, assistantMessageId, m => ({
      ...m,
      rawText,
    }));

    const visible = stripEmotionTags(rawText).trim();
    if (!visible && pendingOps.length === 0) {
      bubbleState.conversation = updateAssistant(bubbleState.conversation, assistantMessageId, m => ({
        ...m,
        text: "（我刚刚走神了，可以再说一遍吗？）",
        emotion: "confused",
      }));
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    bubbleState.errorText = message;
    reportGlobalError(err, "runtime.sendText");
  } finally {
    bubbleState.isSending = false;
  }
}

function enqueueOp(op: PendingOp) {
  if (op.type === "text" && !op.text) return;

  const last = pendingOps[pendingOps.length - 1];
  if (op.type === "text" && last?.type === "text") {
    last.text += op.text;
  } else {
    pendingOps.push(op);
  }

  if (!typingTimer) startTyping();
}

function startTyping() {
  if (typingTimer) return;

  const tick = () => {
    const assistantId = activeAssistantId;
    if (!assistantId) return;

    if (pendingOps.length === 0) {
      if (typingTimer) window.clearTimeout(typingTimer);
      typingTimer = null;
      return;
    }

    let nextEmotion = typingEmotion;
    const appended: Array<{ emotion: Emotion; text: string }> = [];

    while (pendingOps.length > 0) {
      const head = pendingOps[0];
      if (!head || head.type !== "emotion") break;
      nextEmotion = head.emotion;
      pendingOps.shift();
    }

    const head = pendingOps[0];
    if (head && head.type === "text") {
      const { taken, rest } = takeChars(head.text, 1);
      head.text = rest;
      if (!head.text) pendingOps.shift();
      if (taken) appended.push({ emotion: nextEmotion, text: taken });
    }

    typingEmotion = nextEmotion;

    bubbleState.conversation = updateAssistant(bubbleState.conversation, assistantId, m => {
      let nextText = m.text;
      let nextSegments = m.segments ?? [];
      for (const chunk of appended) {
        nextText += chunk.text;
        nextSegments = appendToSegments(nextSegments, chunk.emotion, chunk.text);
      }

      const resolvedEmotion = m.emotion === "thinking" ? nextEmotion : nextEmotion;
      return { ...m, text: nextText, emotion: resolvedEmotion, segments: nextSegments };
    });

    const lastChar = appended[appended.length - 1]?.text;
    const delay = computeDelayMs(lastChar ?? "", TYPING_BASE_MS);
    typingTimer = window.setTimeout(tick, delay);
  };

  typingTimer = window.setTimeout(tick, TYPING_BASE_MS);
}

export function getDerivedEmotionFromLastAssistant(text: string | null | undefined): Emotion {
  if (!text?.trim()) return "neutral";
  return inferEmotionFromText(text);
}
