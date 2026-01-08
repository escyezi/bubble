import { proxy } from "valtio";

import { DEFAULT_SETTINGS } from "../constants";
import { newConversation } from "../chatUtils";
import type { Conversation, Settings } from "../types";
import type { StorageKind } from "../storage";

export type BubbleState = {
  settings: Settings;
  conversation: Conversation;
  composerText: string;
  isSending: boolean;
  errorText: string | null;
  isSettingsOpen: boolean;
  isHistoryOpen: boolean;
  hydrationStatus: "idle" | "loading" | "ready" | "error";
  storageKind: StorageKind | null;
};

export const bubbleState = proxy<BubbleState>({
  settings: DEFAULT_SETTINGS,
  conversation: newConversation(),
  composerText: "",
  isSending: false,
  errorText: null,
  isSettingsOpen: false,
  isHistoryOpen: false,
  hydrationStatus: "idle",
  storageKind: null,
});
