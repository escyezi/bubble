import { useEffect } from "react";

type Reporter = (error: unknown, context?: string) => void;

export function useGlobalErrorHandlers(reportError: Reporter) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onError = (event: ErrorEvent) => {
      reportError(event.error ?? event.message, "window.error");
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportError(event.reason, "window.unhandledrejection");
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [reportError]);
}

