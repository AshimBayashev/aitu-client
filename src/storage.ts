import {
  ACCENTS,
  BACKGROUNDS,
  DEFAULT_SETTINGS,
  DENSITIES,
  FONTS,
  seedFolders,
  seedMessages,
  seedUnread,
  THEMES,
} from "./data";
import type { Folder, Message, Settings } from "./types";

export const STORAGE_KEY = "aitu-client-v1";

export type Persisted = {
  settings: Settings;
  folders: Folder[];
  messages: Record<string, Message[]>;
  unread: Record<string, number>;
  recentEmoji: string[];
};

function isTheme(value: unknown): value is Settings["theme"] {
  return THEMES.some((theme) => theme.id === value);
}

function isDensity(value: unknown): value is Settings["density"] {
  return DENSITIES.some((density) => density.id === value);
}

function isChatBg(value: unknown): value is Settings["chatBg"] {
  return BACKGROUNDS.some((background) => background.id === value);
}

function sanitizeSettings(value: Partial<Settings> | undefined): Settings {
  const settings = { ...DEFAULT_SETTINGS, ...value };
  if (!isTheme(settings.theme)) settings.theme = DEFAULT_SETTINGS.theme;
  if (!isDensity(settings.density)) settings.density = DEFAULT_SETTINGS.density;
  if (!isChatBg(settings.chatBg)) settings.chatBg = DEFAULT_SETTINGS.chatBg;
  if (!FONTS.some((font) => font.id === settings.fontFamily)) {
    settings.fontFamily = DEFAULT_SETTINGS.fontFamily;
  }
  if (!ACCENTS.includes(settings.accent) && !/^#[0-9a-fA-F]{6}$/.test(settings.accent)) {
    settings.accent = DEFAULT_SETTINGS.accent;
  }
  const size = Number(settings.fontSize);
  settings.fontSize = Number.isFinite(size) ? Math.min(20, Math.max(13, size)) : DEFAULT_SETTINGS.fontSize;
  return settings;
}

function sanitizeFolders(value: unknown): Folder[] {
  if (!Array.isArray(value)) return seedFolders();
  const folders = value.filter((folder): folder is Folder => {
    if (!folder || typeof folder !== "object") return false;
    const candidate = folder as Folder;
    return typeof candidate.id === "string" && typeof candidate.name === "string";
  });
  const rest = folders
    .filter((folder) => folder.id !== "all")
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      chatIds: Array.isArray(folder.chatIds) ? folder.chatIds.filter((id) => typeof id === "string") : [],
    }));
  return [{ id: "all", name: "Все", chatIds: null, locked: true }, ...rest];
}

export function loadState(): Persisted {
  const fresh: Persisted = {
    settings: DEFAULT_SETTINGS,
    folders: seedFolders(),
    messages: seedMessages(),
    unread: seedUnread(),
    recentEmoji: [],
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      settings: sanitizeSettings(parsed.settings),
      folders: sanitizeFolders(parsed.folders),
      messages: parsed.messages && typeof parsed.messages === "object" ? parsed.messages : fresh.messages,
      unread: parsed.unread && typeof parsed.unread === "object" ? parsed.unread : fresh.unread,
      recentEmoji: Array.isArray(parsed.recentEmoji)
        ? parsed.recentEmoji.filter((item) => typeof item === "string").slice(0, 24)
        : [],
    };
  } catch {
    return fresh;
  }
}

export function saveState(state: Persisted) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...state, messages: withoutLocalMedia(state.messages) }),
  );
}

function withoutLocalMedia(messages: Record<string, Message[]>): Record<string, Message[]> {
  const next: Record<string, Message[]> = {};
  for (const [chatId, items] of Object.entries(messages)) {
    next[chatId] = items.map((item) => {
      if (!item.files?.some((file) => file.localUrl)) return item;
      return {
        ...item,
        files: item.files.map((file) => {
          if (!file.localUrl) return file;
          const { localUrl: _localUrl, ...rest } = file;
          return rest;
        }),
      };
    });
  }
  return next;
}
