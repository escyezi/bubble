import type { Settings } from "./types";

export const SETTINGS_KEY = "bubble.settings.v1";
export const CONVERSATION_KEY = "bubble.conversation.current.v1";

export const DEFAULT_SETTINGS: Settings = {
  openaiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
};

export const TYPING_BASE_MS = 50;

export const QUICK_PROMPTS = [
  { label: "吟诵俳句吧！", text: "吟诵俳句吧！" },
  {
    label: "讲个笑话",
    text: "讲个笑话，然后换行解释一下笑话的笑点，解释完笑点后直接接一个逗号并以\"令人忍俊不禁。\"结尾",
  },
  { label: "吐槽一下", text: "风趣地吐槽一下社会现象" },
];
