import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import {
  QUICK_PROMPTS,
  CONVERSATION_KEY,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  TYPING_BASE_MS,
} from "./constants";
import { appendToSegments, computeDelayMs, newConversation, newId, takeChars, updateAssistant } from "./chatUtils";
import { EMOTICONS, inferEmotionFromText } from "./emotion";
import { createEmotionTagParser, stripEmotionTags } from "./emotionTags";
import { streamOpenAIChat } from "./openai";
import { useLocalStorageState } from "./storage";
import type { Conversation, Emotion, Message, Settings } from "./types";
import { HistoryModal } from "./components/HistoryModal";
import { SettingsModal } from "./components/SettingsModal";

export function BubbleApp() {
  const [settings, setSettings] = useLocalStorageState<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const defaultConversation = useMemo(() => newConversation(), []);
  const [conversation, setConversation] = useLocalStorageState<Conversation>(CONVERSATION_KEY, defaultConversation);

  const [composerText, setComposerText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const pendingOpsRef = useRef<Array<{ type: "text"; text: string } | { type: "emotion"; emotion: Emotion }>>([]);
  const typingEmotionRef = useRef<Emotion>("neutral");
  const activeAssistantIdRef = useRef<string | null>(null);
  const parserRef = useRef<ReturnType<typeof createEmotionTagParser> | null>(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const lastAssistant = useMemo(() => {
    return conversation.messages.findLast(m => m.role === "assistant") ?? null;
  }, [conversation.messages]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    };
  }, []);

  const bubbleText =
    lastAssistant?.text && lastAssistant.text.trim()
      ? lastAssistant.text
      : isSending
        ? "…"
        : "你好，我是 Bubble。想聊点什么？";

  const currentEmotion: Emotion = isSending
    ? (lastAssistant?.emotion ?? "thinking")
    : lastAssistant?.emotion
      ? lastAssistant.emotion
      : lastAssistant?.text?.trim()
        ? inferEmotionFromText(lastAssistant.text)
        : "neutral";

  const send = async () => {
    const text = composerText.trim();
    if (!text) return;
    await sendText(text);
  };

  const sendText = async (text: string) => {
    if (!text.trim()) return;

    setErrorText(null);
    setIsSending(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = null;
    pendingOpsRef.current = [];
    typingEmotionRef.current = "neutral";
    parserRef.current = createEmotionTagParser();

    const userMessage: Message = {
      id: newId(),
      role: "user",
      text,
      createdAt: Date.now(),
      emotion: "neutral",
    };

    const nextConversation: Conversation = {
      ...conversation,
      title: conversation.title ?? text.slice(0, 24),
      messages: [...conversation.messages, userMessage],
      updatedAt: Date.now(),
    };

    const assistantMessageId = newId();
    activeAssistantIdRef.current = assistantMessageId;
    const assistantPlaceholder: Message = {
      id: assistantMessageId,
      role: "assistant",
      text: "",
      rawText: "",
      createdAt: Date.now(),
      emotion: "thinking",
      segments: [],
    };

    setConversation({
      ...nextConversation,
      messages: [...nextConversation.messages, assistantPlaceholder],
      updatedAt: Date.now(),
    });
    setComposerText("");

    try {
      const parser = parserRef.current;
      if (!parser) throw new Error("Parser not ready");

      const { rawText } = await streamOpenAIChat(
        settings,
        nextConversation.messages,
        {
          onDeltaText: deltaText => {
            const events = parser.push(deltaText);
            for (const ev of events) {
              if (ev.type === "text") {
                enqueueOp({ type: "text", text: ev.text });
              } else {
                enqueueOp({ type: "emotion", emotion: ev.emotion });
              }
            }
          },
        },
        abortRef.current.signal,
      );

      const tailEvents = parser.flush();
      for (const ev of tailEvents) {
        if (ev.type === "text") enqueueOp({ type: "text", text: ev.text });
        if (ev.type === "emotion") enqueueOp({ type: "emotion", emotion: ev.emotion });
      }

      setConversation(prev => updateAssistant(prev, assistantMessageId, m => ({ ...m, rawText })));

      const visible = stripEmotionTags(rawText).trim();
      if (!visible && pendingOpsRef.current.length === 0) {
        setConversation(prev =>
          updateAssistant(prev, assistantMessageId, m => ({
            ...m,
            text: "（我刚刚走神了，可以再说一遍吗？）",
            emotion: "confused",
          })),
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setErrorText(message);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  const enqueueOp = (op: { type: "text"; text: string } | { type: "emotion"; emotion: Emotion }) => {
    if (op.type === "text" && !op.text) return;

    const ops = pendingOpsRef.current;
    const last = ops[ops.length - 1];
    if (op.type === "text" && last?.type === "text") {
      last.text += op.text;
    } else {
      ops.push(op);
    }

    if (!typingTimerRef.current) startTyping();
  };

  const startTyping = () => {
    if (typingTimerRef.current) return;

    const tick = () => {
      const assistantId = activeAssistantIdRef.current;
      if (!assistantId) return;

      if (pendingOpsRef.current.length === 0) {
        if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
        return;
      }

      let nextEmotion = typingEmotionRef.current;
      const appended: Array<{ emotion: Emotion; text: string }> = [];

      // Consume any pending emotion ops immediately (no visible output).
      while (pendingOpsRef.current.length > 0) {
        const head = pendingOpsRef.current[0];
        if (!head) break;
        if (head.type !== "emotion") break;
        nextEmotion = head.emotion;
        pendingOpsRef.current.shift();
      }

      // Output exactly 1 visible character per tick.
      const head = pendingOpsRef.current[0];
      if (head && head.type === "text") {
        const { taken, rest } = takeChars(head.text, 1);
        head.text = rest;
        if (!head.text) pendingOpsRef.current.shift();
        if (taken) appended.push({ emotion: nextEmotion, text: taken });
      }

      typingEmotionRef.current = nextEmotion;

      // Apply emotion even if this tick didn't output a char (rare but possible).
      setConversation(prev =>
        updateAssistant(prev, assistantId, m => {
          let text = m.text;
          let segments = m.segments ?? [];
          for (const chunk of appended) {
            text += chunk.text;
            segments = appendToSegments(segments, chunk.emotion, chunk.text);
          }

          const resolvedEmotion = m.emotion === "thinking" ? nextEmotion : nextEmotion;
          return { ...m, text, emotion: resolvedEmotion, segments };
        }),
      );

      const lastChar = appended[appended.length - 1]?.text;
      const delay = computeDelayMs(lastChar ?? "", TYPING_BASE_MS);
      typingTimerRef.current = window.setTimeout(tick, delay);
    };

    typingTimerRef.current = window.setTimeout(tick, TYPING_BASE_MS);
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="fixed top-0 right-0 p-3 flex items-center gap-2 z-10">
        <Button size="icon" variant="ghost" onClick={() => setIsHistoryOpen(true)} aria-label="Open chat history">
          记录
        </Button>
        <Button size="icon" variant="ghost" onClick={() => setIsSettingsOpen(true)} aria-label="Open settings">
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
              <div className="absolute -top-2 left-10 size-4 rotate-45 border-l border-t bg-card" />
            </div>
            {errorText ? <div className="mt-2 text-xs text-destructive">{errorText}</div> : null}
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
                disabled={isSending}
                onClick={() => void sendText(prompt.text)}
              >
                {prompt.label}
              </Button>
            ))}
          </div>

          <div className="flex gap-2 items-end">
            <Textarea
              ref={inputRef}
              value={composerText}
              onChange={e => setComposerText(e.target.value)}
              placeholder="和 Bubble 说点什么…"
              className="min-h-[44px] max-h-[160px] resize-none"
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!isSending) void send();
                }
              }}
              aria-label="Message input"
            />
            <Button
              onClick={() => void send()}
              disabled={isSending || !composerText.trim()}
              className="h-[44px]"
            >
              {isSending ? "…" : "发送"}
            </Button>
          </div>
        </div>
      </div>

      <SettingsModal
        open={isSettingsOpen}
        settings={settings}
        onSave={setSettings}
        onClose={() => setIsSettingsOpen(false)}
      />
      <HistoryModal
        open={isHistoryOpen}
        conversation={conversation}
        onClose={() => setIsHistoryOpen(false)}
        onClear={() => setConversation(newConversation())}
      />
    </div>
  );
}
