import type { Emotion } from "./types";

export const EMOTICONS: Record<Emotion, string> = {
  neutral: "(・_・)",
  happy: "(≧▽≦)",
  sad: "(；ω；)",
  angry: "(╬ಠ益ಠ)",
  confused: "(⊙_⊙？)",
  thinking: "(￢_￢)",
  excited: "(☆▽☆)",
  surprised: "(⊙o⊙)",
  shy: "(〃▽〃)",
  sleepy: "(－_－) zzZ",
  love: "(♡‿♡)",
};

export function inferEmotionFromText(text: string): Emotion {
  const t = text.toLowerCase();
  if (/(\?+|？+)/.test(text) || /(not sure|unsure|maybe|i think)/.test(t)) return "confused";
  if (/(sorry|抱歉|对不起|难过|伤心|哭)/.test(text)) return "sad";
  if (/(angry|mad|hate|烦|生气|气死|滚)/.test(t)) return "angry";
  if (/(哈哈|hahaha|lol|lmao|开心|高兴|太棒|不错|耶)/.test(t)) return "happy";
  return "neutral";
}
