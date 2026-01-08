import { DEFAULT_SETTINGS } from "../constants";
import { newConversation } from "../chatUtils";
import type { Conversation, Settings } from "../types";
import { createDexieAdapter, type DexieStorage } from "./dexie";
import { createLocalStorageAdapter } from "./local";
import type { BubbleStorage } from "./types";

let storagePromise: Promise<BubbleStorage> | null = null;

export function getBubbleStorage(): Promise<BubbleStorage> {
  if (!storagePromise) storagePromise = createBubbleStorage();
  return storagePromise;
}

async function createBubbleStorage(): Promise<BubbleStorage> {
  const local = createLocalStorageAdapter();

  let primary: BubbleStorage = local;
  let dexie: DexieStorage | null = null;
  try {
    dexie = await createDexieAdapter();
    await maybeMigrateFromLocalStorage(dexie);
    primary = dexie;
  } catch {
    dexie = null;
    primary = local;
  }

  return {
    get kind() {
      return primary.kind;
    },

    async getSettings() {
      if (!dexie) return await local.getSettings();
      try {
        return await dexie.getSettings();
      } catch {
        return await local.getSettings();
      }
    },

    async setSettings(next) {
      if (!dexie) return await local.setSettings(next);
      try {
        await dexie.setSettings(next);
      } catch {
        await local.setSettings(next);
      }
    },

    async getLatestConversation() {
      if (!dexie) return await local.getLatestConversation();
      try {
        return await dexie.getLatestConversation();
      } catch {
        return await local.getLatestConversation();
      }
    },

    async upsertConversation(conversation) {
      if (!dexie) return await local.upsertConversation(conversation);
      try {
        await dexie.upsertConversation(conversation);
      } catch {
        await local.upsertConversation(conversation);
      }
    },

    async clearConversations() {
      if (dexie) {
        try {
          await dexie.clearConversations();
        } catch {
          // Ignore and still clear local.
        }
      }
      await local.clearConversations();
    },
  };
}

async function maybeMigrateFromLocalStorage(storage: DexieStorage) {
  const local = createLocalStorageAdapter();

  const [hasSettings, hasConversation] = await Promise.all([
    storage.db.settings.count().then(c => c > 0),
    storage.db.conversations.count().then(c => c > 0),
  ]);

  if (!hasSettings) {
    const settings = (await local.getSettings()) ?? DEFAULT_SETTINGS;
    await storage.setSettings(settings);
  }

  if (!hasConversation) {
    const conversation = (await local.getLatestConversation()) ?? newConversation();
    await storage.upsertConversation(conversation);
  }
}

export async function loadInitialState(): Promise<{
  storage: BubbleStorage;
  settings: Settings;
  conversation: Conversation;
}> {
  const storage = await getBubbleStorage();
  const [settings, conversation] = await Promise.all([
    storage.getSettings(),
    storage.getLatestConversation(),
  ]);

  return {
    storage,
    settings: settings ?? DEFAULT_SETTINGS,
    conversation: conversation ?? newConversation(),
  };
}

export type { BubbleStorage } from "./types";
export type { StorageKind } from "./types";
