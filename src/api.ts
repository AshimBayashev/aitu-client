import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const inDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type SessionStatus = {
  loggedIn: boolean;
  name: string | null;
  userId: string | null;
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
};

export type RemoteMessage = {
  id: string;
  outgoing: boolean;
  text: string;
  sentAt: number;
  author: string | null;
};

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

export function sendRemote(peerId: string, peerType: string, localId: string, text: string): Promise<void> {
  return invoke<void>("send_message", { peerId, peerType, localId, text });
}

export function markRead(peerId: string, peerType: string, messageIds: string[]): Promise<void> {
  return invoke<void>("mark_read", { peerId, peerType, messageIds });
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

export function explain(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Не удалось связаться с Aitu";
}
