import { proxy } from "valtio";

import { CONVERSATION_KEY, DEFAULT_SETTINGS, SETTINGS_KEY } from "../constants";
import { newConversation } from "../chatUtils";
import { safeJsonParse } from "../storage";
import type { Conversation, Settings } from "../types";

export type BubbleState = {
  settings: Settings;
  conversation: Conversation;
  composerText: string;
  isSending: boolean;
  errorText: string | null;
  isSettingsOpen: boolean;
  isHistoryOpen: boolean;
};

function readLocalStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const parsed = safeJsonParse<T>(window.localStorage.getItem(key));
  return parsed ?? fallback;
}

const defaultConversation = newConversation();

export const bubbleState = proxy<BubbleState>({
  settings: readLocalStorage(SETTINGS_KEY, DEFAULT_SETTINGS),
  conversation: readLocalStorage(CONVERSATION_KEY, defaultConversation),
  composerText: "",
  isSending: false,
  errorText: null,
  isSettingsOpen: false,
  isHistoryOpen: false,
});

