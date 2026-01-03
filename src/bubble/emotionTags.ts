import type { Emotion } from "./types";

export type EmotionTagEvent =
  | { type: "text"; text: string }
  | { type: "emotion"; emotion: Emotion; rawTag: string };

const EMOTION_TAG_SHORT: Record<Emotion, string> = {
  neutral: "n",
  happy: "h",
  sad: "s",
  angry: "a",
  confused: "c",
  thinking: "t",
  excited: "ex",
  surprised: "sp",
  shy: "sh",
  sleepy: "sl",
  love: "lv",
};

const EMOTION_TAG_LABELS: Record<Emotion, string> = {
  neutral: "neutral",
  happy: "happy",
  sad: "sad",
  angry: "angry",
  confused: "confused",
  thinking: "thinking",
  excited: "excited",
  surprised: "surprised",
  shy: "shy",
  sleepy: "sleepy",
  love: "love",
};

const EMOTION_TAG_ALIASES: Record<Emotion, string[]> = {
  neutral: ["n", "neutral"],
  happy: ["h", "happy"],
  sad: ["s", "sad"],
  angry: ["a", "angry"],
  confused: ["c", "confused"],
  thinking: ["t", "thinking"],
  excited: ["ex", "excited"],
  surprised: ["sp", "surprised", "surprise"],
  shy: ["sh", "shy"],
  sleepy: ["sl", "sleepy", "sleep"],
  love: ["lv", "love"],
};

const EMOTION_ALIAS_MAP = new Map<string, Emotion>(
  Object.entries(EMOTION_TAG_ALIASES).flatMap(([emotion, aliases]) =>
    aliases.map(alias => [alias.toLowerCase(), emotion as Emotion]),
  ),
);

const EMOTION_ALIAS_PATTERN = Object.values(EMOTION_TAG_ALIASES)
  .flat()
  .map(escapeRegExp)
  .join("|");

const EMOTION_TAG_REGEX = new RegExp(`\\[\\[(?:e:)?(?:${EMOTION_ALIAS_PATTERN})\\]\\]`, "gi");

export const EMOTION_TAG_SHORT_LIST = Object.values(EMOTION_TAG_SHORT);

export function buildEmotionTagInstruction() {
  const tagList = EMOTION_TAG_SHORT_LIST.map(tag => `[[${tag}]]`).join(" ");
  const descList = Object.entries(EMOTION_TAG_SHORT)
    .map(([emotion, tag]) => `${tag} ${EMOTION_TAG_LABELS[emotion as Emotion]}`)
    .join(", ");
  return `Emotion tags must be exactly one of: ${tagList} (${descList}). Tags should appear right before the text they affect. Do not explain the tags.`;
}

export function stripEmotionTags(text: string): string {
  return text.replace(EMOTION_TAG_REGEX, "");
}

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
  return EMOTION_ALIAS_MAP.get(v.toLowerCase()) ?? null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
