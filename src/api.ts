import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const inDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type SessionStatus = {
  loggedIn: boolean;
  name: string | null;
  userId: string | null;
  avatar: string | null;
};

export type RemoteChat = {
  id: string;
  title: string;
  kind: "direct" | "group" | "channel" | string;
  peerType: string;
  unread: number;
  members: number | null;
  online: boolean;
  preview: string;
  lastAt: number;
  avatar: string | null;
};

export type RemoteFile = {
  id: string;
  name: string;
  size: number;
  kind: string;
};

export type RemoteMessage = {
  id: string;
  outgoing: boolean;
  text: string;
  sentAt: number;
  author: string | null;
  files: RemoteFile[];
  reply?: { id: string; author: string; text: string } | null;
};

export function mediaSrc(fileId: string): string {
  return mediaUrl("file", fileId);
}

export function avatarSrc(fileId: string): string {
  return mediaUrl("avatar", fileId);
}

function mediaUrl(kind: "file" | "avatar", fileId: string): string {
  const split = fileId.indexOf("?");
  const path = split === -1 ? fileId : fileId.slice(0, split);
  const query = split === -1 ? "" : fileId.slice(split);
  return `https://media-cdn.aitu.io/api/v2/media/download/${kind}/${encodeURIComponent(path)}${query}`;
}

export function sessionStatus(): Promise<SessionStatus> {
  return invoke<SessionStatus>("session_status");
}

export function beginLogin(): Promise<void> {
  return invoke<void>("begin_login");
}

export function logout(): Promise<void> {
  return invoke<void>("logout");
}

export function listDialogs(): Promise<RemoteChat[]> {
  return invoke<RemoteChat[]>("list_dialogs");
}

export function listHistory(peerId: string, peerType: string): Promise<RemoteMessage[]> {
  return invoke<RemoteMessage[]>("list_history", { peerId, peerType });
}

export function sendRemote(
  peerId: string,
  peerType: string,
  localId: string,
  text: string,
  paths: string[],
): Promise<void> {
  return invoke<void>("send_message", { peerId, peerType, localId, text, paths });
}

export function sendVoiceRemote(
  peerId: string,
  peerType: string,
  localId: string,
  data: string,
  mime: string,
): Promise<void> {
  return invoke<void>("send_voice", { peerId, peerType, localId, data, mime });
}

export function openAttachment(fileId: string, name: string): Promise<void> {
  return invoke<void>("open_attachment", { fileId, name });
}

export function markRead(peerId: string, peerType: string, messageIds: string[]): Promise<void> {
  return invoke<void>("mark_read", { peerId, peerType, messageIds });
}

export function setActiveChat(chatId: string | null): Promise<void> {
  return invoke<void>("set_active_chat", { chatId });
}

export function onSession(handler: (status: SessionStatus) => void): Promise<UnlistenFn> {
  return listen<SessionStatus>("aitu-session", (event) => handler(event.payload));
}

export function onLoginError(handler: (message: string) => void): Promise<UnlistenFn> {
  return listen<{ message: string }>("aitu-login-error", (event) => handler(event.payload.message));
}

export function onLoginClosed(handler: () => void): Promise<UnlistenFn> {
  return listen("aitu-login-closed", () => handler());
}

export function onOpenChat(handler: (chatId: string) => void): Promise<UnlistenFn> {
  return listen<{ chatId?: string }>("aitu-open-chat", (event) => {
    const chatId = event.payload.chatId;
    if (chatId) handler(chatId);
  });
}

export function explain(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Не удалось связаться с Aitu";
}
