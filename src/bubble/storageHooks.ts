import { useEffect, useMemo, useRef, useState } from "react";

import { safeJsonParse } from "./utils/json";
export { safeJsonParse };

export function useLocalStorageState<T>(key: string, defaultValue: T) {
  const initial = useMemo(() => {
    if (typeof window === "undefined") return defaultValue;
    const parsed = safeJsonParse<T>(window.localStorage.getItem(key));
    return parsed ?? defaultValue;
  }, [key, defaultValue]);

  const [value, setValue] = useState<T>(initial);

  const latestRef = useRef<{ key: string; raw: string } | null>(null);
  const writeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const raw = JSON.stringify(value);
    latestRef.current = { key, raw };

    if (writeTimerRef.current) window.clearTimeout(writeTimerRef.current);
    writeTimerRef.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(key, raw);
      } catch {
        // Ignore quota errors for MVP.
      }
    }, 200);
  }, [key, value]);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      const latest = latestRef.current;
      if (!latest) return;
      try {
        window.localStorage.setItem(latest.key, latest.raw);
      } catch {
        // Ignore quota errors for MVP.
      }
    };
  }, []);

  return [value, setValue] as const;
}
