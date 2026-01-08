import { useEffect, useMemo, useRef } from "react";
import { useSnapshot } from "valtio";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { QUICK_PROMPTS } from "./constants";
import { EMOTICONS, inferEmotionFromText } from "./emotion";
import { GlobalErrorModal } from "./components/GlobalErrorModal";
import { HistoryModal } from "./components/HistoryModal";
import { SettingsModal } from "./components/SettingsModal";
import { useGlobalErrorHandlers } from "./errorHooks";
import {
  bubbleState,
  clearGlobalError,
  cleanupBubbleRuntime,
  clearConversation,
  closeHistory,
  closeSettings,
  initBubbleStatePersistence,
  openHistory,
  openSettings,
  reportGlobalError,
  saveSettings,
  send,
  sendText,
  setComposerText,
} from "./state";

export function BubbleApp() {
  const snap = useSnapshot(bubbleState);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wasSendingRef = useRef(false);

  useGlobalErrorHandlers(reportGlobalError);

  useEffect(() => {
    initBubbleStatePersistence();
    inputRef.current?.focus();

    return () => {
      cleanupBubbleRuntime();
    };
  }, []);

  const lastAssistant = useMemo(() => {
    return snap.conversation.messages.findLast(m => m.role === "assistant") ?? null;
  }, [snap.conversation.messages]);

  useEffect(() => {
    if (wasSendingRef.current && !snap.isSending) inputRef.current?.focus();
    wasSendingRef.current = snap.isSending;
  }, [snap.isSending]);

  const bubbleText =
    lastAssistant?.text && lastAssistant.text.trim()
      ? lastAssistant.text
      : snap.isSending
        ? "…"
        : "你好，我是 Bubble。想聊点什么？";

  const currentEmotion = snap.isSending
    ? (lastAssistant?.emotion ?? "thinking")
    : lastAssistant?.emotion
      ? lastAssistant.emotion
      : lastAssistant?.text?.trim()
        ? inferEmotionFromText(lastAssistant.text)
        : "neutral";

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="fixed top-0 right-0 p-3 flex items-center gap-2 z-10">
        <Button size="icon" variant="ghost" onClick={openHistory} aria-label="Open chat history">
          记录
        </Button>
        <Button size="icon" variant="ghost" onClick={openSettings} aria-label="Open settings">
          设置
        </Button>
      </header>

      <main className="mx-auto max-w-3xl px-6 pt-20 pb-28">
        <div className="flex flex-col items-center gap-6">
          {/* <div className="text-xs text-muted-foreground select-none">Bubble</div> */}
          <div className="text-[56px] sm:text-[72px] md:text-[84px] leading-none select-none">
            {EMOTICONS[currentEmotion] ?? EMOTICONS.neutral}
          </div>

          <div className="w-full">
            <div className="relative rounded-2xl border bg-card px-4 py-3 text-sm leading-relaxed shadow-sm">
              <div className="whitespace-pre-wrap break-words">{bubbleText}</div>
              <div className="absolute -top-2 left-1/2 size-4 -translate-x-1/2 rotate-45 border-l border-t bg-card" />
            </div>
            {snap.errorText ? <div className="mt-2 text-xs text-destructive">{snap.errorText}</div> : null}
          </div>
        </div>
      </main>

      <div className="fixed bottom-0 inset-x-0 bg-background/70 backdrop-blur border-t">
        <div className="mx-auto max-w-3xl px-6 py-4 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map(prompt => (
              <Button
                key={prompt.label}
                type="button"
                size="sm"
                variant="secondary"
                disabled={snap.isSending || snap.hydrationStatus !== "ready"}
                onClick={() => void sendText(prompt.text)}
              >
                {prompt.label}
              </Button>
            ))}
          </div>

          <div className="flex gap-2 items-end">
            <Textarea
              ref={inputRef}
              value={snap.composerText}
              onChange={e => setComposerText(e.target.value)}
              placeholder="和 Bubble 说点什么…"
              className="min-h-[44px] max-h-[160px] resize-none"
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!snap.isSending && snap.hydrationStatus === "ready") void send();
                }
              }}
              aria-label="Message input"
            />
            <Button
              onClick={() => void send()}
              disabled={snap.isSending || snap.hydrationStatus !== "ready" || !snap.composerText.trim()}
              className="h-[44px]"
            >
              {snap.isSending ? "…" : "发送"}
            </Button>
          </div>
        </div>
      </div>

      <SettingsModal
        open={snap.isSettingsOpen}
        settings={bubbleState.settings}
        onSave={saveSettings}
        onClose={closeSettings}
      />
      <HistoryModal
        open={snap.isHistoryOpen}
        conversation={bubbleState.conversation}
        onClose={closeHistory}
        onClear={clearConversation}
      />
      <GlobalErrorModal open={!!snap.globalError} error={snap.globalError} onClose={clearGlobalError} />
    </div>
  );
}
