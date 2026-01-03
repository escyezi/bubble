export type Emotion =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "confused"
  | "thinking"
  | "excited"
  | "surprised"
  | "shy"
  | "sleepy"
  | "love";

export type Role = "user" | "assistant";

export type Settings = {
  openaiKey: string;
  baseUrl: string;
  model: string;
};

export type Message = {
  id: string;
  role: Role;
  text: string;
  rawText?: string;
  createdAt: number;
  emotion?: Emotion;
  segments?: Array<{
    text: string;
    emotion?: Emotion;
  }>;
};

export type Conversation = {
  id: string;
  title?: string;
  messages: Message[];
  updatedAt: number;
};
