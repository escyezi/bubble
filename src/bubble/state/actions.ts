import { newConversation } from "../chatUtils";
import type { Conversation, Settings } from "../types";
import { bubbleState } from "./state";
import { ensureHydrated, getHydratedStorage } from "./hydration";
import { pausePersistence, startPersistence, stopPersistence } from "./persistence";
import {
  cleanupRuntime,
  getDerivedEmotionFromLastAssistant,
  sendTextRuntime,
} from "./runtime";

let clearHistoryPromise: Promise<void> | null = null;

export function initBubbleStatePersistence() {
  startPersistence();
}

export function cleanupBubbleRuntime() {
  cleanupRuntime();
  stopPersistence();
}

async function clearHistory(conversationToKeep: Conversation) {
  await pausePersistence(async () => {
    await ensureHydrated();
    const storage = getHydratedStorage();
    if (!storage) return;
    await storage.clearConversations();
  });
  bubbleState.conversation = conversationToKeep;
}

function startNewConversation(): Conversation {
  const next = newConversation();
  bubbleState.conversation = next;
  return next;
}

export function setComposerText(text: string) {
  bubbleState.composerText = text;
}

export function openSettings() {
  bubbleState.isSettingsOpen = true;
}

export function closeSettings() {
  bubbleState.isSettingsOpen = false;
}

export function openHistory() {
  bubbleState.isHistoryOpen = true;
}

export function closeHistory() {
  bubbleState.isHistoryOpen = false;
}

export function saveSettings(next: Settings) {
  bubbleState.settings = next;
}

export function clearConversation() {
  cleanupRuntime();
  const nextConversation = startNewConversation();
  clearHistoryPromise = clearHistory(nextConversation);
}

async function waitForClearHistory() {
  const p = clearHistoryPromise;
  if (!p) return;
  clearHistoryPromise = null;
  await p.catch(() => {});
}

export async function send() {
  const text = bubbleState.composerText.trim();
  if (!text) return;
  await sendText(text);
}

export async function sendText(text: string) {
  if (!text.trim()) return;

  await waitForClearHistory();
  await ensureHydrated();
  if (bubbleState.hydrationStatus !== "ready") return;

  await sendTextRuntime(text);
}

export { getDerivedEmotionFromLastAssistant };
