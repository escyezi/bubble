import { Button } from "@/components/ui/button";

import type { GlobalError } from "../state/errors";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  error: GlobalError | null;
  onClose: () => void;
};

export function GlobalErrorModal({ open, error, onClose }: Props) {
  const message = error?.message ?? "Unknown error";
  const details = error?.stack ?? null;

  return (
    <Modal open={open} title="发生错误" onClose={onClose} className="max-w-2xl">
      <div className="space-y-3">
        <div className="text-sm break-words">{message}</div>
        {error?.context ? (
          <div className="text-xs text-muted-foreground break-words">Context: {error.context}</div>
        ) : null}
        {details ? (
          <pre className="max-h-[45vh] overflow-auto rounded-lg border bg-muted/30 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
            {details}
          </pre>
        ) : null}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  );
}

