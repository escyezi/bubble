import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { Settings } from "../types";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  settings: Readonly<Settings>;
  onSave: (next: Settings) => void;
  onClose: () => void;
};

export function SettingsModal({ open, settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(() => ({ ...settings }));

  useEffect(() => {
    if (open) setDraft({ ...settings });
  }, [open, settings]);

  return (
    <Modal open={open} title="设置" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={e => {
          e.preventDefault();
          onSave(draft);
          onClose();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="openaiKey">OpenAI Key</Label>
          <Input
            id="openaiKey"
            type="password"
            value={draft.openaiKey}
            onChange={e => setDraft(prev => ({ ...prev, openaiKey: e.target.value }))}
            placeholder="sk-..."
            autoComplete="off"
          />
          <div className="text-xs text-muted-foreground">Key 会保存在本机浏览器的 localStorage。</div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="baseUrl">Base URL</Label>
          <Input
            id="baseUrl"
            value={draft.baseUrl}
            onChange={e => setDraft(prev => ({ ...prev, baseUrl: e.target.value }))}
            placeholder="https://api.openai.com/v1"
          />
          <div className="text-xs text-muted-foreground">需要支持浏览器 CORS。默认是 OpenAI 官方地址。</div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="model">Model</Label>
          <Input
            id="model"
            value={draft.model}
            onChange={e => setDraft(prev => ({ ...prev, model: e.target.value }))}
            placeholder="gpt-4o-mini"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="submit">保存</Button>
        </div>
      </form>
    </Modal>
  );
}
