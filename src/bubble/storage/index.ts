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
  try {
    const dexie = await createDexieAdapter();
    await maybeMigrateFromLocalStorage(dexie);
    primary = dexie;
  } catch {
    primary = local;
  }

  return {
    get kind() {
      return primary.kind;
    },

    async getSettings() {
      return await primary.getSettings();
    },

    async setSettings(next) {
      await primary.setSettings(next);
    },

    async getCurrentConversationId() {
      return await primary.getCurrentConversationId();
    },

    async setCurrentConversationId(id) {
      await primary.setCurrentConversationId(id);
    },

    async getCurrentConversation() {
      return await primary.getCurrentConversation();
    },

    async getLatestConversation() {
      return await primary.getLatestConversation();
    },

    async upsertConversation(conversation) {
      await primary.upsertConversation(conversation);
    },

    async clearConversations() {
      await primary.clearConversations();
      if (primary.kind === "dexie") await local.clearConversations();
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
    await storage.setCurrentConversationId(conversation.id);
  }
}

export async function loadInitialState(): Promise<{
  storage: BubbleStorage;
  settings: Settings;
  conversation: Conversation;
}> {
  const storage = await getBubbleStorage();
  const [settings, current] = await Promise.all([
    storage.getSettings(),
    storage.getCurrentConversation(),
  ]);
  let conversation = current;
  if (!conversation) {
    conversation = await storage.getLatestConversation();
    if (conversation) await storage.setCurrentConversationId(conversation.id);
  }

  return {
    storage,
    settings: settings ?? DEFAULT_SETTINGS,
    conversation: conversation ?? newConversation(),
  };
}

export type { BubbleStorage } from "./types";
export type { StorageKind } from "./types";
