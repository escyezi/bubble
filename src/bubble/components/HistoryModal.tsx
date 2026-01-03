import { Button } from "@/components/ui/button";

import type { Conversation } from "../types";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  conversation: Conversation;
  onClose: () => void;
  onClear: () => void;
};

export function HistoryModal({ open, conversation, onClose, onClear }: Props) {
  return (
    <Modal open={open} title="对话记录" onClose={onClose} className="max-w-2xl">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-xs text-muted-foreground truncate">
          {conversation.title ? `会话：${conversation.title}` : "当前会话"}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onClear}>
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
        <Button type="button" variant="ghost" onClick={onClose}>
          关闭
        </Button>
      </div>
    </Modal>
  );
}
