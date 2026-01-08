import Dexie, { type Table } from "dexie";

import type { Conversation, Settings } from "../types";
import type { BubbleStorage } from "./types";

export type SettingsRow = Settings & {
  id: "default";
  updatedAt: number;
};

export type ConversationRow = Conversation;

export type AppRow = {
  id: "default";
  currentConversationId: string;
  updatedAt: number;
};

class BubbleDb extends Dexie {
  settings!: Table<SettingsRow, string>;
  conversations!: Table<ConversationRow, string>;
  app!: Table<AppRow, string>;

  constructor() {
    super("bubble");
    this.version(1).stores({
      settings: "id, updatedAt",
      conversations: "id, updatedAt",
    });
    this.version(2).stores({
      settings: "id, updatedAt",
      conversations: "id, updatedAt",
      app: "id",
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

    async getCurrentConversationId() {
      const row = await db.app.get("default");
      return row?.currentConversationId ?? null;
    },

    async setCurrentConversationId(id) {
      if (!id) {
        await db.app.delete("default");
        return;
      }
      const row: AppRow = { id: "default", currentConversationId: id, updatedAt: Date.now() };
      await db.app.put(row);
    },

    async getCurrentConversation() {
      const appRow = await db.app.get("default");
      const id = appRow?.currentConversationId ?? null;
      if (!id) return null;
      const conversationRow = await db.conversations.get(id);
      return conversationRow ?? null;
    },

    async getLatestConversation() {
      const row = await db.conversations.orderBy("updatedAt").last();
      return row ?? null;
    },

    async upsertConversation(conversation) {
      await db.transaction("rw", db.conversations, db.app, async () => {
        await db.conversations.put(conversation);
        const row: AppRow = {
          id: "default",
          currentConversationId: conversation.id,
          updatedAt: Date.now(),
        };
        await db.app.put(row);
      });
    },

    async clearConversations() {
      await db.conversations.clear();
      await db.app.delete("default");
    },
  };
}
