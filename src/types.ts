export type ChatKind = "direct" | "group" | "channel";

export type Chat = {
  id: string;
  title: string;
  kind: ChatKind;
  pinned: boolean;
  members?: number;
  presence?: "online" | "recent";
  peerType?: string;
  preview?: string;
  lastAt?: number;
  avatar?: string;
};

export type FileKind = "image" | "video" | "audio" | "file" | "gif" | "music" | "sticker";

export type ChatFile = {
  id: string;
  name: string;
  size: number;
  kind: FileKind | string;
};

export type Message = {
  id: string;
  chatId: string;
  outgoing: boolean;
  text: string;
  sentAt: number;
  delivery: "sending" | "sent" | "failed";
  author?: string;
  files?: ChatFile[];
};

export type Folder = {
  id: string;
  name: string;
  chatIds: string[] | null;
  locked?: boolean;
};

export type ThemeName = "dark" | "light";
export type Density = "compact" | "cozy" | "relaxed";
export type ChatBg = "plain" | "mist" | "dusk" | "paper" | "grid";

export type Settings = {
  theme: ThemeName;
  accent: string;
  fontFamily: string;
  fontSize: number;
  density: Density;
  chatBg: ChatBg;
};

export type EmojiItem = {
  char: string;
  name: string;
};

export type EmojiCategory = {
  id: string;
  label: string;
  items: EmojiItem[];
};

export type FolderDraft = {
  id: string | null;
  name: string;
  chatIds: string[];
};
