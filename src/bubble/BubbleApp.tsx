import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { EMOTICONS, inferEmotionFromText } from "./emotion";
import { createEmotionTagParser } from "./emotionTags";
import { streamOpenAIChat } from "./openai";
import { useLocalStorageState } from "./storage";
import type { Conversation, Emotion, Message, Settings } from "./types";
import { Modal } from "./components/Modal";

const SETTINGS_KEY = "bubble.settings.v1";
const CONVERSATION_KEY = "bubble.conversation.current.v1";

const DEFAULT_SETTINGS: Settings = {
  openaiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
};

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function newConversation(): Conversation {
  return {
    id: newId(),
    messages: [],
    updatedAt: Date.now(),
  };
}

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

  const TYPING_BASE_MS = 50;

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<Settings>(settings);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isSettingsOpen) setSettingsDraft(settings);
  }, [isSettingsOpen, settings]);

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

  const stripEmotionTags = (text: string) => {
    return text.replace(
      /\[\[(?:e:)?(?:n|h|s|a|c|t|ex|sp|sh|sl|lv|neutral|happy|sad|angry|confused|thinking|excited|surprised|shy|sleepy|love)\]\]/gi,
      "",
    );
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
      const delay = computeDelayMs(lastChar ?? "");
      typingTimerRef.current = window.setTimeout(tick, delay);
    };

    typingTimerRef.current = window.setTimeout(tick, TYPING_BASE_MS);
  };

  const takeChars = (input: string, maxChars: number) => {
    if (!input) return { taken: "", rest: "", count: 0 };
    let taken = "";
    let count = 0;
    for (const ch of input) {
      taken += ch;
      count++;
      if (count >= maxChars) break;
    }
    return { taken, rest: input.slice(taken.length), count };
  };

  const computeDelayMs = (ch: string) => {
    if (!ch) return TYPING_BASE_MS;
    if (ch === "\n") return TYPING_BASE_MS + 220;

    if (/[,，]/.test(ch)) return TYPING_BASE_MS + 70;
    if (/[。.!?！？]/.test(ch)) return TYPING_BASE_MS + 120;
    if (/[;；:：]/.test(ch)) return TYPING_BASE_MS + 90;
    if (/[…]/.test(ch)) return TYPING_BASE_MS + 160;

    return TYPING_BASE_MS;
  };

  const appendToSegments = (
    segments: Array<{ text: string; emotion?: Emotion }>,
    emotion: Emotion,
    text: string,
  ): Array<{ text: string; emotion?: Emotion }> => {
    if (!text) return segments;
    const last = segments[segments.length - 1];
    if (last && last.emotion === emotion) {
      const next = segments.slice();
      next[next.length - 1] = { ...last, text: `${last.text}${text}` };
      return next;
    }
    return [...segments, { text, emotion }];
  };

  const updateAssistant = (
    convo: Conversation,
    messageId: string,
    update: (msg: Message) => Message,
  ): Conversation => {
    const idx = convo.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return convo;
    const current = convo.messages[idx];
    if (!current || current.role !== "assistant") return convo;
    const messages = convo.messages.slice();
    messages[idx] = update(current);
    return { ...convo, messages, updatedAt: Date.now() };
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
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isSending}
              onClick={() => void sendText("吟诵俳句吧！")}
            >
              吟诵俳句吧！
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isSending}
              onClick={() =>
                void sendText(
                  "讲个笑话，然后换行解释一下笑话的笑点，解释完笑点后直接接一个逗号并以\"令人忍俊不禁。\"结尾",
                )
              }
            >
              讲个笑话
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isSending}
              onClick={() => void sendText("风趣地吐槽一下社会现象")}
            >
              吐槽一下
            </Button>
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

      <Modal open={isSettingsOpen} title="设置" onClose={() => setIsSettingsOpen(false)}>
        <form
          className="space-y-4"
          onSubmit={e => {
            e.preventDefault();
            setSettings(settingsDraft);
            setIsSettingsOpen(false);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="openaiKey">OpenAI Key</Label>
            <Input
              id="openaiKey"
              type="password"
              value={settingsDraft.openaiKey}
              onChange={e => setSettingsDraft(prev => ({ ...prev, openaiKey: e.target.value }))}
              placeholder="sk-..."
              autoComplete="off"
            />
            <div className="text-xs text-muted-foreground">
              Key 会保存在本机浏览器的 localStorage。
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="baseUrl">Base URL</Label>
            <Input
              id="baseUrl"
              value={settingsDraft.baseUrl}
              onChange={e => setSettingsDraft(prev => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="https://api.openai.com/v1"
            />
            <div className="text-xs text-muted-foreground">需要支持浏览器 CORS。默认是 OpenAI 官方地址。</div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              value={settingsDraft.model}
              onChange={e => setSettingsDraft(prev => ({ ...prev, model: e.target.value }))}
              placeholder="gpt-4o-mini"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setIsSettingsOpen(false)}>
              取消
            </Button>
            <Button type="submit">保存</Button>
          </div>
        </form>
      </Modal>

      <Modal open={isHistoryOpen} title="对话记录" onClose={() => setIsHistoryOpen(false)} className="max-w-2xl">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-xs text-muted-foreground truncate">
            {conversation.title ? `会话：${conversation.title}` : "当前会话"}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setConversation(newConversation());
              }}
            >
              清空
            </Button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-auto rounded-lg border bg-card">
          {conversation.messages.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">暂无记录。</div>
          ) : (
            <ul className="divide-y">
              {conversation.messages.map(m => (
                <li key={m.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium">{m.role === "user" ? "你" : "Bubble"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(m.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="mt-2 text-sm whitespace-pre-wrap break-words">
                    {m.role === "assistant" ? (m.rawText ?? m.text) : m.text}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-3">
          <Button type="button" variant="ghost" onClick={() => setIsHistoryOpen(false)}>
            关闭
          </Button>
        </div>
      </Modal>
    </div>
  );
}
