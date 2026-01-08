import { subscribeKey } from "valtio/utils";

import { CONVERSATION_KEY, SETTINGS_KEY, TYPING_BASE_MS } from "../constants";
import {
  appendToSegments,
  computeDelayMs,
  newConversation,
  newId,
  takeChars,
  updateAssistant,
} from "../chatUtils";
import { inferEmotionFromText } from "../emotion";
import { createEmotionTagParser, stripEmotionTags } from "../emotionTags";
import { streamOpenAIChat } from "../openai";
import type { Conversation, Emotion, Message, Settings } from "../types";
import { bubbleState } from "./state";

type PendingOp = { type: "text"; text: string } | { type: "emotion"; emotion: Emotion };

let abortController: AbortController | null = null;
let typingTimer: number | null = null;
let pendingOps: PendingOp[] = [];
let typingEmotion: Emotion = "neutral";
let activeAssistantId: string | null = null;
let parser: ReturnType<typeof createEmotionTagParser> | null = null;

let persistenceStarted = false;
let stopPersistence: (() => void) | null = null;
let flushPersistence: (() => void) | null = null;
let pagehideHandler: (() => void) | null = null;

function safeLocalStorageSet(key: string, raw: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, raw);
  } catch(e) {
    console.error("Failed to write to localStorage:", e);
  }
}

export function initBubbleStatePersistence() {
  if (persistenceStarted) return;
  persistenceStarted = true;

  if (typeof window === "undefined") return;

  let settingsRaw = "";
  let conversationRaw = "";
  let settingsTimer: number | null = null;
  let conversationTimer: number | null = null;

  const flush = () => {
    if (settingsTimer) window.clearTimeout(settingsTimer);
    if (conversationTimer) window.clearTimeout(conversationTimer);
    settingsTimer = null;
    conversationTimer = null;

    if (settingsRaw) safeLocalStorageSet(SETTINGS_KEY, settingsRaw);
    if (conversationRaw) safeLocalStorageSet(CONVERSATION_KEY, conversationRaw);
  };

  const scheduleSettings = (next: Settings) => {
    const nextRaw = JSON.stringify(next);
    if (nextRaw === settingsRaw) return;
    settingsRaw = nextRaw;
    if (settingsTimer) window.clearTimeout(settingsTimer);
    settingsTimer = window.setTimeout(() => safeLocalStorageSet(SETTINGS_KEY, settingsRaw), 200);
  };

  const scheduleConversation = (next: Conversation) => {
    const nextRaw = JSON.stringify(next);
    if (nextRaw === conversationRaw) return;
    conversationRaw = nextRaw;
    if (conversationTimer) window.clearTimeout(conversationTimer);
    conversationTimer = window.setTimeout(
      () => safeLocalStorageSet(CONVERSATION_KEY, conversationRaw),
      200,
    );
  };

  const stopSettings = subscribeKey(bubbleState, "settings", scheduleSettings);
  const stopConversation = subscribeKey(bubbleState, "conversation", scheduleConversation);
  stopPersistence = () => {
    stopSettings();
    stopConversation();
  };
  flushPersistence = flush;
  pagehideHandler = flush;
  window.addEventListener("pagehide", flush);
  scheduleSettings(bubbleState.settings);
  scheduleConversation(bubbleState.conversation);
}

export function cleanupBubbleRuntime() {
  abortController?.abort();
  abortController = null;

  if (typingTimer) window.clearTimeout(typingTimer);
  typingTimer = null;
  pendingOps = [];
  typingEmotion = "neutral";
  activeAssistantId = null;
  parser = null;

  flushPersistence?.();
  flushPersistence = null;
  if (pagehideHandler) window.removeEventListener("pagehide", pagehideHandler);
  pagehideHandler = null;

  stopPersistence?.();
  stopPersistence = null;
  persistenceStarted = false;
}

export function setComposerText(text: string) {
  bubbleState.composerText = text;
}

export function openSettings() {
  bubbleState.isSettingsOpen = true;
}

export function closeSettings() {
  bubbleState.isSettingsOpen = false;
}

export function openHistory() {
  bubbleState.isHistoryOpen = true;
}

export function closeHistory() {
  bubbleState.isHistoryOpen = false;
}

export function saveSettings(next: Settings) {
  bubbleState.settings = next;
}

export function clearConversation() {
  bubbleState.conversation = newConversation();
}

export async function send() {
  const text = bubbleState.composerText.trim();
  if (!text) return;
  await sendText(text);
}

export async function sendText(text: string) {
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

  const nextConversation: Conversation = {
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
