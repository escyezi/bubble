import type { Emotion } from "./types";

export type EmotionTagEvent =
  | { type: "text"; text: string }
  | { type: "emotion"; emotion: Emotion; rawTag: string };

// Emotion tags are embedded inline in assistant text and should NOT be displayed.
// Recommended tag format:
// - Short: [[n]] [[h]] [[s]] [[a]] [[c]] [[t]]
// - Extra emotions: [[ex]] [[sp]] [[sh]] [[sl]] [[lv]]
// Also accepted for robustness: [[e:h]] and full words like [[happy]].
export function createEmotionTagParser() {
  let buffer = "";

  return {
    push(chunk: string): EmotionTagEvent[] {
      buffer += chunk;
      return drain();
    },
    flush(): EmotionTagEvent[] {
      const events: EmotionTagEvent[] = [];
      if (buffer) events.push({ type: "text", text: buffer });
      buffer = "";
      return events;
    },
  };

  function drain(): EmotionTagEvent[] {
    const events: EmotionTagEvent[] = [];

    while (true) {
      const start = buffer.indexOf("[[");
      if (start === -1) {
        if (buffer) {
          events.push({ type: "text", text: buffer });
          buffer = "";
        }
        return events;
      }

      if (start > 0) {
        events.push({ type: "text", text: buffer.slice(0, start) });
        buffer = buffer.slice(start);
      }

      const end = buffer.indexOf("]]", 2);
      if (end === -1) {
        return events;
      }

      const rawTag = buffer.slice(0, end + 2);
      const inner = buffer.slice(2, end);
      buffer = buffer.slice(end + 2);

      const emotion = parseEmotion(inner);
      if (emotion) {
        events.push({ type: "emotion", emotion, rawTag });
      } else {
        // Unknown tag - treat as normal text.
        events.push({ type: "text", text: rawTag });
      }
    }
  }
}

function parseEmotion(raw: string): Emotion | null {
  let v = raw.trim();
  if (!v) return null;
  if (v.toLowerCase().startsWith("e:")) v = v.slice(2).trim();
  const lower = v.toLowerCase();

  if (lower === "n" || lower === "neutral") return "neutral";
  if (lower === "h" || lower === "happy") return "happy";
  if (lower === "s" || lower === "sad") return "sad";
  if (lower === "a" || lower === "angry") return "angry";
  if (lower === "c" || lower === "confused") return "confused";
  if (lower === "t" || lower === "thinking") return "thinking";

  if (lower === "ex" || lower === "excited") return "excited";
  if (lower === "sp" || lower === "surprised" || lower === "surprise") return "surprised";
  if (lower === "sh" || lower === "shy") return "shy";
  if (lower === "sl" || lower === "sleepy" || lower === "sleep") return "sleepy";
  if (lower === "lv" || lower === "love") return "love";

  return null;
}
