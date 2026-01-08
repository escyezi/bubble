import { loadInitialState, type BubbleStorage } from "../storage";
import { reportGlobalError } from "./errors";
import { bubbleState } from "./state";

let hydratePromise: Promise<void> | null = null;
let storage: BubbleStorage | null = null;

export function getHydratedStorage(): BubbleStorage | null {
  return storage;
}

export async function ensureHydrated() {
  if (bubbleState.hydrationStatus === "ready") return;
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    bubbleState.hydrationStatus = "loading";
    try {
      const initial = await loadInitialState();
      storage = initial.storage;
      bubbleState.storageKind = initial.storage.kind;
      bubbleState.settings = initial.settings;
      bubbleState.conversation = initial.conversation;
      bubbleState.hydrationStatus = "ready";
    } catch (err) {
      bubbleState.hydrationStatus = "error";
      reportGlobalError(err, "hydration.ensureHydrated");
    }
  })();

  return hydratePromise;
}
