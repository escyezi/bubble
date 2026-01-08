import Dexie, { type Table } from "dexie";

import type { Conversation, Settings } from "../types";
import type { BubbleStorage } from "./types";

export type SettingsRow = Settings & {
  id: "default";
  updatedAt: number;
};

export type ConversationRow = Conversation;

class BubbleDb extends Dexie {
  settings!: Table<SettingsRow, string>;
  conversations!: Table<ConversationRow, string>;

  constructor() {
    super("bubble");
    this.version(1).stores({
      settings: "id, updatedAt",
      conversations: "id, updatedAt",
    });
  }
}

export type DexieStorage = BubbleStorage & {
  readonly kind: "dexie";
  readonly db: BubbleDb;
};

export async function createDexieAdapter(): Promise<DexieStorage> {
  if (typeof window === "undefined") throw new Error("No window");
  if (typeof indexedDB === "undefined") throw new Error("indexedDB unavailable");

  const db = new BubbleDb();
  await db.open();

  return {
    kind: "dexie",
    db,

    async getSettings() {
      const row = await db.settings.get("default");
      if (!row) return null;
      const { id: _id, updatedAt: _updatedAt, ...settings } = row;
      return settings;
    },

    async setSettings(next) {
      const row: SettingsRow = { id: "default", updatedAt: Date.now(), ...next };
      await db.settings.put(row);
    },

    async getLatestConversation() {
      const row = await db.conversations.orderBy("updatedAt").last();
      return row ?? null;
    },

    async upsertConversation(conversation) {
      await db.conversations.put(conversation);
    },

    async clearConversations() {
      await db.conversations.clear();
    },
  };
}
