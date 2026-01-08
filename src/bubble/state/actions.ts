import { subscribeKey } from "valtio/utils";

import { TYPING_BASE_MS } from "../constants";
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
import { loadInitialState, type BubbleStorage } from "../storage";
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
let hydratePromise: Promise<void> | null = null;
let storage: BubbleStorage | null = null;

let pendingSettings: Settings | null = null;
let pendingConversation: Conversation | null = null;
let settingsTimer: number | null = null;
let conversationTimer: number | null = null;
let lastSavedSettingsRaw = "";
let lastSavedConversationUpdatedAt = 0;
let suppressNextEmptyConversationPersist = false;
let clearHistoryPromise: Promise<void> | null = null;

function toPlainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function initBubbleStatePersistence() {
  if (persistenceStarted) return;
  persistenceStarted = true;

  void ensureHydrated().then(() => {
    if (!storage) return;

    const flush = () => {
      if (settingsTimer) window.clearTimeout(settingsTimer);
      if (conversationTimer) window.clearTimeout(conversationTimer);
      settingsTimer = null;
      conversationTimer = null;

      const s = storage;
      if (!s) return;

      if (pendingSettings) {
        const next = toPlainJson(pendingSettings);
        pendingSettings = null;
        void s.setSettings(next);
        lastSavedSettingsRaw = JSON.stringify(next);
      }

      if (pendingConversation) {
        const next = toPlainJson(pendingConversation);
        pendingConversation = null;
        void s.upsertConversation(next);
        lastSavedConversationUpdatedAt = next.updatedAt;
      }
    };

    const stopSettings = subscribeKey(bubbleState, "settings", next => {
      const nextRaw = JSON.stringify(next);
      if (nextRaw === lastSavedSettingsRaw) return;
      pendingSettings = next;

      if (settingsTimer) window.clearTimeout(settingsTimer);
      settingsTimer = window.setTimeout(() => {
        const s = storage;
        if (!s || !pendingSettings) return;
        const current = toPlainJson(pendingSettings);
        pendingSettings = null;
        void s.setSettings(current);
        lastSavedSettingsRaw = JSON.stringify(current);
      }, 200);
    });

    const stopConversation = subscribeKey(bubbleState, "conversation", next => {
      if (suppressNextEmptyConversationPersist && next.messages.length === 0) {
        suppressNextEmptyConversationPersist = false;
        lastSavedConversationUpdatedAt = next.updatedAt;
        pendingConversation = null;
        return;
      }
      if (next.updatedAt < lastSavedConversationUpdatedAt) return;
      pendingConversation = next;

      if (conversationTimer) window.clearTimeout(conversationTimer);
      conversationTimer = window.setTimeout(() => {
        const s = storage;
        if (!s || !pendingConversation) return;
        const current = toPlainJson(pendingConversation);
        pendingConversation = null;
        void s.upsertConversation(current);
        lastSavedConversationUpdatedAt = current.updatedAt;
      }, 250);
    });

    stopPersistence = () => {
      stopSettings();
      stopConversation();
    };

    flushPersistence = flush;
    if (typeof window !== "undefined") {
      pagehideHandler = flush;
      window.addEventListener("pagehide", flush);
    }
  });
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

async function ensureHydrated() {
  if (bubbleState.hydrationStatus === "ready") return;
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    bubbleState.hydrationStatus = "loading";
    try {
      const initial = await loadInitialState();
      storage = initial.storage;
      bubbleState.storageKind = initial.storage.kind;
      bubbleState.settings = initial.settings;
      bubbleState.conversation = initial.conversation;
      bubbleState.hydrationStatus = "ready";
      lastSavedSettingsRaw = JSON.stringify(initial.settings);
      lastSavedConversationUpdatedAt = initial.conversation.updatedAt;
    } catch {
      bubbleState.hydrationStatus = "error";
    }
  })();

  return hydratePromise;
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

  if (conversationTimer) window.clearTimeout(conversationTimer);
  conversationTimer = null;
  pendingConversation = null;

  suppressNextEmptyConversationPersist = true;
  bubbleState.conversation = newConversation();

  clearHistoryPromise = (async () => {
    await ensureHydrated();
    await storage?.clearConversations();
  })();
}

export async function send() {
  const text = bubbleState.composerText.trim();
  if (!text) return;
  await sendText(text);
}

export async function sendText(text: string) {
  if (!text.trim()) return;

  if (clearHistoryPromise) await clearHistoryPromise.catch(() => {});
  await ensureHydrated();

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
