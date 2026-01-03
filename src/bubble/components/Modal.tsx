import { useEffect, useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

export function Modal({ open, title, onClose, children, className }: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="absolute inset-0 grid place-items-center p-4">
        <div className={cn("w-full max-w-lg rounded-xl bg-background shadow-lg border", className)}>
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h2 id={titleId} className="text-sm font-semibold">
              {title}
            </h2>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-sm px-2 py-1 rounded-md hover:bg-accent"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
