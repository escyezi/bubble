import { bubbleState } from "./state";

export type GlobalError = {
  id: string;
  message: string;
  name?: string;
  stack?: string;
  context?: string;
  createdAt: number;
};

function newErrorId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeError(error: unknown): Omit<GlobalError, "id" | "createdAt" | "context"> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message || String(error),
      stack: error.stack,
    };
  }
  if (typeof error === "string") return { message: error };
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

export function reportGlobalError(error: unknown, context?: string) {
  const normalized = normalizeError(error);
  const message = normalized.message || "Unknown error";
  const prev = bubbleState.globalError;
  if (prev && prev.message === message && prev.context === context) return;

  bubbleState.globalError = {
    id: newErrorId(),
    createdAt: Date.now(),
    context,
    ...normalized,
    message,
  };
  // Keep error visible in console / devtools.
  console.error(context ? `[Bubble] ${context}` : "[Bubble] error", error);
}

export function clearGlobalError() {
  bubbleState.globalError = null;
}
