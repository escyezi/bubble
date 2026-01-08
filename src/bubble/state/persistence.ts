import { snapshot } from "valtio";
import { subscribeKey } from "valtio/utils";

import type { Conversation, Settings } from "../types";
import { reportGlobalError } from "./errors";
import { ensureHydrated, getHydratedStorage } from "./hydration";
import { bubbleState } from "./state";

let started = false;
let stopSubscriptions: (() => void) | null = null;

let pendingSettings: Settings | null = null;
let pendingConversation: Conversation | null = null;
let settingsTimer: number | null = null;
let conversationTimer: number | null = null;
let lastSavedSettingsRaw = "";
let lastSavedConversationUpdatedAt = 0;

let pauseDepth = 0;
let pagehideHandler: (() => void) | null = null;

function cloneForStorage<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function toPersistable<T extends object>(value: T): T {
  return cloneForStorage(snapshot(value) as T);
}

function clearTimers() {
  if (settingsTimer) window.clearTimeout(settingsTimer);
  if (conversationTimer) window.clearTimeout(conversationTimer);
  settingsTimer = null;
  conversationTimer = null;
}

function flush() {
  if (pauseDepth > 0) {
    clearTimers();
    pendingSettings = null;
    pendingConversation = null;
    return;
  }

  clearTimers();
  const storage = getHydratedStorage();
  if (!storage) return;

  if (pendingSettings) {
    const next = pendingSettings;
    pendingSettings = null;
    const nextRaw = JSON.stringify(next);
    void storage
      .setSettings(next)
      .then(() => {
        lastSavedSettingsRaw = nextRaw;
      })
      .catch(err => {
        if (!pendingSettings) pendingSettings = next;
        reportGlobalError(err, "persistence.flush.setSettings");
      });
  }

  if (pendingConversation) {
    const next = pendingConversation;
    pendingConversation = null;
    void storage
      .upsertConversation(next)
      .then(() => {
        lastSavedConversationUpdatedAt = next.updatedAt;
      })
      .catch(err => {
        if (!pendingConversation) pendingConversation = next;
        reportGlobalError(err, "persistence.flush.upsertConversation");
      });
  }
}

export function startPersistence() {
  if (started) return;
  started = true;

  void ensureHydrated().then(() => {
    const storage = getHydratedStorage();
    if (!storage) return;

    const initialSettings = toPersistable(bubbleState.settings);
    lastSavedSettingsRaw = JSON.stringify(initialSettings);
    const initialConversation = toPersistable(bubbleState.conversation);
    lastSavedConversationUpdatedAt = initialConversation.updatedAt;

    const stopSettings = subscribeKey(bubbleState, "settings", next => {
      if (pauseDepth > 0) return;

      const current = toPersistable(next);
      const currentRaw = JSON.stringify(current);
      if (currentRaw === lastSavedSettingsRaw) return;
      pendingSettings = current;

      if (settingsTimer) window.clearTimeout(settingsTimer);
      settingsTimer = window.setTimeout(() => {
        if (pauseDepth > 0) return;
        const storage = getHydratedStorage();
        if (!storage || !pendingSettings) return;
        const next = pendingSettings;
        pendingSettings = null;
        const nextRaw = JSON.stringify(next);
        void storage
          .setSettings(next)
          .then(() => {
            lastSavedSettingsRaw = nextRaw;
          })
          .catch(err => {
            if (!pendingSettings) pendingSettings = next;
            reportGlobalError(err, "persistence.debounce.setSettings");
          });
      }, 200);
    });

    const stopConversation = subscribeKey(bubbleState, "conversation", next => {
      if (pauseDepth > 0) return;
      if (next.messages.length === 0) return;

      const current = toPersistable(next);
      if (current.updatedAt < lastSavedConversationUpdatedAt) return;
      pendingConversation = current;

      if (conversationTimer) window.clearTimeout(conversationTimer);
      conversationTimer = window.setTimeout(() => {
        if (pauseDepth > 0) return;
        const storage = getHydratedStorage();
        if (!storage || !pendingConversation) return;
        const next = pendingConversation;
        pendingConversation = null;
        void storage
          .upsertConversation(next)
          .then(() => {
            lastSavedConversationUpdatedAt = next.updatedAt;
          })
          .catch(err => {
            if (!pendingConversation) pendingConversation = next;
            reportGlobalError(err, "persistence.debounce.upsertConversation");
          });
      }, 250);
    });

    stopSubscriptions = () => {
      stopSettings();
      stopConversation();
    };

    if (typeof window !== "undefined") {
      pagehideHandler = flush;
      window.addEventListener("pagehide", flush);
    }
  });
}

export function stopPersistence() {
  flush();
  stopSubscriptions?.();
  stopSubscriptions = null;
  clearTimers();
  pendingSettings = null;
  pendingConversation = null;

  if (pagehideHandler) window.removeEventListener("pagehide", pagehideHandler);
  pagehideHandler = null;

  started = false;
}

export async function pausePersistence<T>(fn: () => Promise<T>): Promise<T> {
  const wasPaused = pauseDepth > 0;
  pauseDepth += 1;
  if (!wasPaused) {
    clearTimers();
    pendingSettings = null;
    pendingConversation = null;
  }

  try {
    return await fn();
  } finally {
    pauseDepth -= 1;
  }
}
