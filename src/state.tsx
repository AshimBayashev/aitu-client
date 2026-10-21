import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  beginLogin,
  explain,
  inDesktop,
  listDialogs,
  listHistory,
  logout as logoutRemote,
  markRead,
  onLoginClosed,
  onLoginError,
  onOpenChat,
  onSession,
  setActiveChat,
  sendRemote,
  sendVoiceRemote,
  sessionStatus,
  type RemoteChat,
  type RemoteMessage,
} from "./api";
import { CHATS, DEFAULT_SETTINGS, seedFolders, seedMessages, seedUnread } from "./data";
import { loadState, saveState } from "./storage";
import { bytesToBase64, voiceFileName } from "./voice";
import type { Chat, Folder, FolderDraft, Message, MessageReply, Settings } from "./types";

export type Connection = "demo" | "checking" | "signed-out" | "connecting" | "live";

type AppModel = {
  settings: Settings;
  chats: Chat[];
  folders: Folder[];
  messages: Record<string, Message[]>;
  unread: Record<string, number>;
  recentEmoji: string[];
  activeFolderId: string;
  activeChatId: string | null;
  settingsOpen: boolean;
  folderDraft: FolderDraft | null;
  connection: Connection;
  accountName: string | null;
  accountAvatar: string | null;
  loginError: string | null;
  listError: string | null;
  historyError: string | null;
  historyReady: Record<string, boolean>;
  patchSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
  resetLocal: () => void;
  setActiveFolder: (folderId: string) => void;
  selectChat: (chatId: string) => void;
  sendMessage: (chatId: string, text: string, paths?: string[], reply?: MessageReply) => void;
  sendVoice: (chatId: string, audio: Blob, reply?: MessageReply) => void;
  rememberEmoji: (char: string) => void;
  setSettingsOpen: (open: boolean) => void;
  openCreateFolder: () => void;
  openEditFolder: (folderId: string) => void;
  closeFolderEditor: () => void;
  saveFolder: (draft: FolderDraft) => string | null;
  deleteFolder: (folderId: string) => void;
  toggleChatFolder: (folderId: string, chatId: string) => void;
  login: () => void;
  logout: () => void;
};

const AppContext = createContext<AppModel | null>(null);

const RESERVED_FOLDERS = new Set(["all", "direct", "group", "channel", "personal", "work", "channels"]);

function toChat(remote: RemoteChat): Chat {
  const kind = remote.kind === "group" || remote.kind === "channel" ? remote.kind : "direct";
  return {
    id: remote.id,
    title: remote.title,
    kind,
    pinned: false,
    members: remote.members ?? undefined,
    presence: remote.online ? "online" : undefined,
    peerType: remote.peerType,
    preview: remote.preview,
    lastAt: remote.lastAt,
    avatar: remote.avatar ?? undefined,
  };
}

function toMessage(chatId: string, remote: RemoteMessage): Message {
  return {
    id: remote.id,
    chatId,
    outgoing: remote.outgoing,
    text: remote.text,
    sentAt: remote.sentAt,
    delivery: "sent",
    author: remote.author ?? undefined,
    files: remote.files ?? [],
    reply: remote.reply?.id ? remote.reply : undefined,
  };
}

function reconcileFolders(current: Folder[], chats: Chat[]): Folder[] {
  const known = new Set(chats.map((chat) => chat.id));
  const custom = current
    .filter((folder) => !RESERVED_FOLDERS.has(folder.id) && folder.chatIds?.some((id) => known.has(id)))
    .map((folder) => ({
      ...folder,
      chatIds: folder.chatIds?.filter((id) => known.has(id)) ?? [],
    }));
  return [
    { id: "all", name: "Все", chatIds: null, locked: true },
    {
      id: "direct",
      name: "Личные",
      chatIds: chats.filter((chat) => chat.kind === "direct").map((chat) => chat.id),
      locked: true,
    },
    {
      id: "group",
      name: "Группы",
      chatIds: chats.filter((chat) => chat.kind === "group").map((chat) => chat.id),
      locked: true,
    },
    {
      id: "channel",
      name: "Каналы",
      chatIds: chats.filter((chat) => chat.kind === "channel").map((chat) => chat.id),
      locked: true,
    },
    ...custom,
  ];
}

function fileKey(message: Message): string {
  return (message.files ?? []).map((file) => file.name).join("\0");
}

function mergeMessages(existing: Message[] | undefined, incoming: Message[]): Message[] {
  const pending = (existing ?? []).filter((item) => item.delivery === "sending" || item.delivery === "failed");
  const pendingLeft = pending.filter(
    (item) =>
      !incoming.some(
        (server) =>
          server.outgoing &&
          server.text === item.text &&
          fileKey(server) === fileKey(item) &&
          Math.abs(server.sentAt - item.sentAt) < 120_000,
      ),
  );
  return [...incoming, ...pendingLeft].sort((a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id));
}

export function AppProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => loadState(), []);
  const desktop = inDesktop;
  const [settings, setSettings] = useState(initial.settings);
  const [folders, setFolders] = useState(initial.folders);
  const [messages, setMessages] = useState<Record<string, Message[]>>(desktop ? {} : initial.messages);
  const [unread, setUnread] = useState<Record<string, number>>(desktop ? {} : initial.unread);
  const [recentEmoji, setRecentEmoji] = useState(initial.recentEmoji);
  const [chats, setChats] = useState<Chat[]>(desktop ? [] : CHATS);
  const [activeFolderId, setActiveFolderId] = useState("all");
  const [activeChatId, setActiveChatId] = useState<string | null>(desktop ? null : "aigerim");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [folderDraft, setFolderDraft] = useState<FolderDraft | null>(null);
  const [connection, setConnection] = useState<Connection>(desktop ? "checking" : "demo");
  const [accountName, setAccountName] = useState<string | null>(null);
  const [accountAvatar, setAccountAvatar] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyReady, setHistoryReady] = useState<Record<string, boolean>>({});

  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const activeRef = useRef(activeChatId);
  activeRef.current = activeChatId;
  const applyRef = useRef<(remote: RemoteChat[]) => void>(() => {});

  applyRef.current = (remote) => {
    const nextChats = remote.map(toChat);
    setChats(nextChats);
    setFolders((current) => reconcileFolders(current, nextChats));
    setUnread(() => {
      const next: Record<string, number> = {};
      for (const chat of remote) next[chat.id] = chat.id === activeRef.current ? 0 : chat.unread;
      return next;
    });
    setActiveChatId((current) => {
      if (current && nextChats.some((chat) => chat.id === current)) return current;
      return nextChats[0]?.id ?? null;
    });
    setListError(null);
  };

  useEffect(() => {
    saveState({ settings, folders, messages, unread, recentEmoji });
  }, [settings, folders, messages, unread, recentEmoji]);

  useEffect(() => {
    if (!desktop) return;
    let stop = false;
    const unlisten: Array<() => void> = [];
    void (async () => {
      try {
        const status = await sessionStatus();
        if (stop) return;
        if (status.loggedIn) {
          setAccountName(status.name);
          setAccountAvatar(status.avatar);
          setConnection("live");
          try {
            const remote = await listDialogs();
            if (!stop) applyRef.current(remote);
          } catch (error) {
            if (!stop) setListError(explain(error));
          }
        } else {
          setConnection("signed-out");
          setChats([]);
          setActiveChatId(null);
        }
      } catch (error) {
        if (!stop) {
          setConnection("signed-out");
          setLoginError(explain(error));
        }
      }
      if (stop) return;
      unlisten.push(
        await onSession((status) => {
          setAccountName(status.name);
          setAccountAvatar(status.avatar);
          setLoginError(null);
          setConnection("live");
          void listDialogs()
            .then((remote) => {
              if (!stop) applyRef.current(remote);
            })
            .catch((error) => {
              if (!stop) setListError(explain(error));
            });
        }),
      );
      unlisten.push(
        await onLoginClosed(() => {
          if (stop) return;
          setConnection((current) => (current === "live" ? current : "signed-out"));
        }),
      );
      unlisten.push(
        await onLoginError((message) => {
          if (stop) return;
          setLoginError(message);
          setConnection((current) => (current === "live" ? current : "signed-out"));
        }),
      );
    })();
    return () => {
      stop = true;
      unlisten.forEach((stopListening) => stopListening());
    };
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    void setActiveChat(connection === "live" ? activeChatId : null);
  }, [desktop, connection, activeChatId]);

  useEffect(() => {
    if (!desktop) return;
    let stop = false;
    let unlisten: (() => void) | undefined;
    void onOpenChat((chatId) => setActiveChatId(chatId)).then((fn) => {
      if (stop) fn();
      else unlisten = fn;
    });
    return () => {
      stop = true;
      unlisten?.();
    };
  }, [desktop]);

  useEffect(() => {
    if (connection !== "live") return;
    const timer = window.setInterval(() => {
      void listDialogs()
        .then((remote) => applyRef.current(remote))
        .catch((error) => setListError(explain(error)));
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [connection]);

  useEffect(() => {
    if (connection !== "live" || !activeChatId) return;
    const peerType = chatsRef.current.find((chat) => chat.id === activeChatId)?.peerType;
    if (!peerType) return;
    const chatId = activeChatId;
    let stop = false;
    setHistoryError(null);
    const pull = async () => {
      try {
        const incoming = (await listHistory(chatId, peerType)).map((item) => toMessage(chatId, item));
        if (stop) return;
        setMessages((current) => ({ ...current, [chatId]: mergeMessages(current[chatId], incoming) }));
        setHistoryReady((current) => ({ ...current, [chatId]: true }));
        setHistoryError(null);
        const newest = incoming.reduce<Message | null>(
          (best, item) => (!best || item.sentAt >= best.sentAt ? item : best),
          null,
        );
        if (newest) void markRead(chatId, peerType, [newest.id]).catch(() => undefined);
      } catch (error) {
        if (stop) return;
        setHistoryReady((current) => ({ ...current, [chatId]: true }));
        setHistoryError(explain(error));
      }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 5_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [connection, activeChatId]);

  const model = useMemo<AppModel>(
    () => ({
      settings,
      chats,
      folders,
      messages,
      unread,
      recentEmoji,
      activeFolderId,
      activeChatId,
      settingsOpen,
      folderDraft,
      connection,
      accountName,
      accountAvatar,
      loginError,
      listError,
      historyError,
      historyReady,
      patchSettings: (patch) => setSettings((current) => ({ ...current, ...patch })),
      resetSettings: () => setSettings(DEFAULT_SETTINGS),
      resetLocal: () => {
        setSettings(DEFAULT_SETTINGS);
        setRecentEmoji([]);
        setFolderDraft(null);
        if (connection === "demo") {
          setFolders(seedFolders());
          setMessages(seedMessages());
          setUnread(seedUnread());
          setChats(CHATS);
          setActiveFolderId("all");
          setActiveChatId("aigerim");
          return;
        }
        setFolders((current) => reconcileFolders(current.filter((folder) => folder.id === "all"), chats));
        setActiveFolderId("all");
      },
      setActiveFolder: (folderId) => {
        setActiveFolderId(folderId);
        const folder = folders.find((item) => item.id === folderId);
        if (!folder?.chatIds || !activeChatId || folder.chatIds.includes(activeChatId)) return;
        const next = chats.find((chat) => folder.chatIds?.includes(chat.id));
        setActiveChatId(next?.id ?? null);
      },
      selectChat: (chatId) => {
        setActiveChatId(chatId);
        setUnread((current) => ({ ...current, [chatId]: 0 }));
      },
      sendMessage: (chatId, text, paths = [], reply) => {
        const trimmed = text.trim();
        if (!trimmed && paths.length === 0) return;
        const id = crypto.randomUUID();
        const pending: Message = {
          id,
          chatId,
          outgoing: true,
          text: trimmed,
          sentAt: Date.now(),
          delivery: "sending",
          files: paths.map((path) => ({
            id: "",
            name: path.split(/[/\\]/).pop() || "Файл",
            size: 0,
            kind: "file",
          })),
          reply: reply?.id ? reply : undefined,
        };
        setMessages((current) => ({
          ...current,
          [chatId]: [...(current[chatId] ?? []), pending],
        }));
        const chat = chats.find((item) => item.id === chatId);
        if (connection !== "live" || !chat?.peerType) {
          window.setTimeout(() => {
            setMessages((current) => ({
              ...current,
              [chatId]: (current[chatId] ?? []).map((item) =>
                item.id === id ? { ...item, delivery: "sent" } : item,
              ),
            }));
          }, 280);
          return;
        }
        const peerType = chat.peerType;
        void sendRemote(chatId, peerType, id, trimmed, paths, reply?.id)
          .then(async () => {
            try {
              const incoming = (await listHistory(chatId, peerType)).map((item) => toMessage(chatId, item));
              setMessages((current) => ({ ...current, [chatId]: mergeMessages(current[chatId], incoming) }));
            } catch {
              setMessages((current) => ({
                ...current,
                [chatId]: (current[chatId] ?? []).map((item) =>
                  item.id === id ? { ...item, delivery: "sent" } : item,
                ),
              }));
            }
          })
          .catch(() => {
            setMessages((current) => ({
              ...current,
              [chatId]: (current[chatId] ?? []).map((item) =>
                item.id === id ? { ...item, delivery: "failed" } : item,
              ),
            }));
          });
      },
      sendVoice: (chatId, audio, reply) => {
        if (audio.size === 0) return;
        const id = crypto.randomUUID();
        const name = voiceFileName(audio.type);
        const localUrl = URL.createObjectURL(audio);
        const pending: Message = {
          id,
          chatId,
          outgoing: true,
          text: "",
          sentAt: Date.now(),
          delivery: "sending",
          files: [{ id: "", name, size: audio.size, kind: "audio", localUrl }],
          reply: reply?.id ? reply : undefined,
        };
        setMessages((current) => ({
          ...current,
          [chatId]: [...(current[chatId] ?? []), pending],
        }));
        const chat = chats.find((item) => item.id === chatId);
        const mark = (delivery: Message["delivery"]) => {
          setMessages((current) => ({
            ...current,
            [chatId]: (current[chatId] ?? []).map((item) => (item.id === id ? { ...item, delivery } : item)),
          }));
        };
        if (connection !== "live" || !chat?.peerType) {
          window.setTimeout(() => mark("sent"), 280);
          return;
        }
        const peerType = chat.peerType;
        const mime = audio.type.split(";")[0] || "audio/wav";
        void audio
          .arrayBuffer()
          .then((buffer) => sendVoiceRemote(chatId, peerType, id, bytesToBase64(new Uint8Array(buffer)), mime, reply?.id))
          .then(async () => {
            try {
              const incoming = (await listHistory(chatId, peerType)).map((item) => toMessage(chatId, item));
              setMessages((current) => ({ ...current, [chatId]: mergeMessages(current[chatId], incoming) }));
              URL.revokeObjectURL(localUrl);
            } catch {
              mark("sent");
            }
          })
          .catch(() => mark("failed"));
      },
      rememberEmoji: (char) => {
        setRecentEmoji((current) => [char, ...current.filter((item) => item !== char)].slice(0, 24));
      },
      setSettingsOpen,
      openCreateFolder: () => setFolderDraft({ id: null, name: "", chatIds: [] }),
      openEditFolder: (folderId) => {
        const folder = folders.find((item) => item.id === folderId);
        if (!folder || folder.locked || !folder.chatIds) return;
        setFolderDraft({ id: folder.id, name: folder.name, chatIds: [...folder.chatIds] });
      },
      closeFolderEditor: () => setFolderDraft(null),
      saveFolder: (draft) => {
        const name = draft.name.trim();
        if (!name) return "Введите название";
        const duplicate = folders.some(
          (folder) => folder.id !== draft.id && folder.name.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru"),
        );
        if (duplicate) return "Такая папка уже есть";
        if (draft.id) {
          setFolders((current) =>
            current.map((folder) =>
              folder.id === draft.id ? { ...folder, name, chatIds: draft.chatIds } : folder,
            ),
          );
        } else {
          const id = crypto.randomUUID();
          setFolders((current) => [...current, { id, name, chatIds: draft.chatIds }]);
          setActiveFolderId(id);
          if (!activeChatId || !draft.chatIds.includes(activeChatId)) {
            const next = draft.chatIds[0] ?? null;
            setActiveChatId(next);
            if (next) setUnread((current) => ({ ...current, [next]: 0 }));
          }
        }
        setFolderDraft(null);
        return null;
      },
      deleteFolder: (folderId) => {
        setFolders((current) => current.filter((folder) => folder.locked || folder.id !== folderId));
        if (activeFolderId === folderId) setActiveFolderId("all");
        setFolderDraft(null);
      },
      toggleChatFolder: (folderId, chatId) => {
        setFolders((current) =>
          current.map((folder) => {
            if (folder.id !== folderId || !folder.chatIds) return folder;
            const exists = folder.chatIds.includes(chatId);
            return {
              ...folder,
              chatIds: exists ? folder.chatIds.filter((id) => id !== chatId) : [...folder.chatIds, chatId],
            };
          }),
        );
      },
      login: () => {
        setLoginError(null);
        setConnection("connecting");
        void beginLogin().catch((error) => {
          setConnection("signed-out");
          setLoginError(explain(error));
        });
      },
      logout: () => {
        void logoutRemote().catch(() => undefined);
        setConnection("signed-out");
        setAccountName(null);
        setAccountAvatar(null);
        setChats([]);
        setMessages({});
        setUnread({});
        setHistoryReady({});
        setActiveChatId(null);
        setActiveFolderId("all");
        setFolders([{ id: "all", name: "Все", chatIds: null, locked: true }]);
        setListError(null);
        setHistoryError(null);
      },
    }),
    [
      settings,
      chats,
      folders,
      messages,
      unread,
      recentEmoji,
      activeFolderId,
      activeChatId,
      settingsOpen,
      folderDraft,
      connection,
      accountName,
      accountAvatar,
      loginError,
      listError,
      historyError,
      historyReady,
    ],
  );

  return <AppContext.Provider value={model}>{children}</AppContext.Provider>;
}

export function useApp(): AppModel {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp используется внутри AppProvider");
  return value;
}
