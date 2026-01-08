import { CONVERSATION_KEY, SETTINGS_KEY } from "../constants";
import type { Conversation, Settings } from "../types";
import { safeJsonParse } from "../utils/json";
import type { BubbleStorage } from "./types";

function safeLocalStorageGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, raw: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    // Ignore quota errors for MVP.
  }
}

function safeLocalStorageRemove(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore quota errors for MVP.
  }
}

export function createLocalStorageAdapter(): BubbleStorage {
  return {
    kind: "local",

    async getSettings() {
      return safeJsonParse<Settings>(safeLocalStorageGet(SETTINGS_KEY));
    },

    async setSettings(next) {
      safeLocalStorageSet(SETTINGS_KEY, JSON.stringify(next));
    },

    async getCurrentConversationId() {
      const conversation = safeJsonParse<Conversation>(safeLocalStorageGet(CONVERSATION_KEY));
      return conversation?.id ?? null;
    },

    async setCurrentConversationId(id) {
      if (!id) safeLocalStorageRemove(CONVERSATION_KEY);
    },

    async getCurrentConversation() {
      return safeJsonParse<Conversation>(safeLocalStorageGet(CONVERSATION_KEY));
    },

    async getLatestConversation() {
      return safeJsonParse<Conversation>(safeLocalStorageGet(CONVERSATION_KEY));
    },

    async upsertConversation(conversation) {
      safeLocalStorageSet(CONVERSATION_KEY, JSON.stringify(conversation));
    },

    async clearConversations() {
      safeLocalStorageRemove(CONVERSATION_KEY);
    },
  };
}
