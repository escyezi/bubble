import type { Conversation, Settings } from "../types";

export type StorageKind = "dexie" | "local";

export interface BubbleStorage {
  readonly kind: StorageKind;

  getSettings(): Promise<Settings | null>;
  setSettings(next: Settings): Promise<void>;

  getCurrentConversationId(): Promise<string | null>;
  setCurrentConversationId(id: string | null): Promise<void>;
  getCurrentConversation(): Promise<Conversation | null>;

  getLatestConversation(): Promise<Conversation | null>;
  upsertConversation(conversation: Conversation): Promise<void>;

  clearConversations(): Promise<void>;
}
