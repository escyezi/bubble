import type { Conversation, Settings } from "../types";

export type StorageKind = "dexie" | "local";

export interface BubbleStorage {
  readonly kind: StorageKind;

  getSettings(): Promise<Settings | null>;
  setSettings(next: Settings): Promise<void>;

  getLatestConversation(): Promise<Conversation | null>;
  upsertConversation(conversation: Conversation): Promise<void>;

  clearConversations(): Promise<void>;
}
