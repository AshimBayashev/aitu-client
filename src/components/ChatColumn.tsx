import { useEffect, useMemo, useState } from "react";
import { formatStamp } from "../data";
import { Avatar } from "./Avatar";
import { useApp } from "../state";
import type { Chat, Message } from "../types";
import { voicePreview } from "../voice";
import { IconSearch } from "./icons";

type MenuState = { chatId: string; left: number; top: number };

function lastMessage(messages: Message[] | undefined) {
  if (!messages?.length) return null;
  return messages[messages.length - 1];
}

function stampOf(chat: Chat, messages: Record<string, Message[] | undefined>, historyReady: Record<string, boolean>) {
  const last = historyReady[chat.id] ? lastMessage(messages[chat.id])?.sentAt ?? 0 : 0;
  return Math.max(chat.lastAt ?? 0, last);
}

function previewOf(
  chat: Chat,
  messages: Record<string, Message[] | undefined>,
  historyReady: Record<string, boolean>,
) {
  const last = lastMessage(messages[chat.id]);
  const historyTime = historyReady[chat.id] ? last?.sentAt ?? 0 : 0;
  const own = last ? messagePreview(last) : "";
  if (historyTime > 0 && historyTime >= (chat.lastAt ?? 0)) return own;
  return voicePreview(chat.preview ?? "") || chat.preview || own;
}

function messagePreview(message: Message): string {
  if (message.text) return message.text;
  const file = message.files?.[0];
  if (!file) return "";
  return (
    voicePreview(file.name) ||
    (file.kind === "image" || file.kind === "gif"
      ? "Фото"
      : file.kind === "video"
        ? "Видео"
        : file.kind === "audio" || file.kind === "music"
          ? "Аудио"
          : file.name || "Файл")
  );
}

function timeOf(
  chat: Chat,
  messages: Record<string, Message[] | undefined>,
  historyReady: Record<string, boolean>,
) {
  const stamp = stampOf(chat, messages, historyReady);
  return stamp ? formatStamp(stamp) : "";
}

export function ChatColumn() {
  const {
    chats: allChats,
    folders,
    messages,
    unread,
    activeFolderId,
    activeChatId,
    selectChat,
    toggleChatFolder,
    connection,
    listError,
    historyReady,
  } = useApp();
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);

  const folder = folders.find((item) => item.id === activeFolderId) ?? folders[0];
  const editableFolders = folders.filter((item) => item.chatIds && !item.locked);

  const chats = useMemo(() => {
    const allowed = folder?.chatIds;
    const needle = query.trim().toLocaleLowerCase("ru");
    return allChats
      .filter((chat) => {
        if (allowed && !allowed.includes(chat.id)) return false;
        if (!needle) return true;
        return chat.title.toLocaleLowerCase("ru").includes(needle);
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return stampOf(b, messages, historyReady) - stampOf(a, messages, historyReady);
      });
  }, [allChats, folder, historyReady, messages, query]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  function openMenu(chatId: string, x: number, y: number) {
    const width = 220;
    const height = 220;
    setMenu({
      chatId,
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }

  const pinned = chats.filter((chat) => chat.pinned);
  const rest = chats.filter((chat) => !chat.pinned);

  return (
    <section className="chats" aria-label="Список чатов">
      <label className="search">
        <IconSearch />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск"
          aria-label="Поиск чатов"
        />
      </label>
      <div className="chat-scroll">
        {chats.length === 0 && (
          <p className="empty-copy">
            {listError
              ? listError
              : connection === "checking"
                ? "Подключаемся…"
                : connection === "signed-out" || connection === "connecting"
                  ? "После входа здесь будут ваши чаты"
                  : "В этой папке пока нет чатов"}
          </p>
        )}
        {pinned.length > 0 && <p className="section-label">Закреплённые</p>}
        {pinned.map((chat) => (
          <ChatRow
            key={chat.id}
            chat={chat}
            selected={chat.id === activeChatId}
            preview={previewOf(chat, messages, historyReady)}
            time={timeOf(chat, messages, historyReady)}
            unread={unread[chat.id] ?? 0}
            onOpen={() => {
              setMenu(null);
              selectChat(chat.id);
            }}
            onMenu={(x, y) => openMenu(chat.id, x, y)}
          />
        ))}
        {rest.length > 0 && pinned.length > 0 && <p className="section-label">Чаты</p>}
        {rest.map((chat) => (
          <ChatRow
            key={chat.id}
            chat={chat}
            selected={chat.id === activeChatId}
            preview={previewOf(chat, messages, historyReady)}
            time={timeOf(chat, messages, historyReady)}
            unread={unread[chat.id] ?? 0}
            onOpen={() => {
              setMenu(null);
              selectChat(chat.id);
            }}
            onMenu={(x, y) => openMenu(chat.id, x, y)}
          />
        ))}
      </div>
      {menu && (
        <div
          className="menu"
          style={{ left: menu.left, top: menu.top }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <p>В папки</p>
          {editableFolders.length === 0 && <p className="menu-empty">Сначала создайте папку</p>}
          {editableFolders.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={item.chatIds?.includes(menu.chatId) ?? false}
                onChange={() => toggleChatFolder(item.id, menu.chatId)}
              />
              {item.name}
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

function ChatRow({
  chat,
  selected,
  preview,
  time,
  unread,
  onOpen,
  onMenu,
}: {
  chat: Chat;
  selected: boolean;
  preview: string;
  time: string;
  unread: number;
  onOpen: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  return (
    <div className={selected ? "chat-row selected" : "chat-row"}>
      <button type="button" className="chat-open" onClick={onOpen}>
        <Avatar title={chat.title} fileId={chat.avatar} />
        <span className="chat-copy">
          <span className="chat-title">
            <span>{chat.title}</span>
            <time>{time}</time>
          </span>
          <span className="chat-preview">
            <span>{preview}</span>
            {unread > 0 && <span className="badge">{unread > 99 ? "99+" : unread}</span>}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="chat-more"
        aria-label={`Папки для ${chat.title}`}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu(rect.left, rect.bottom + 6);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu(event.clientX, event.clientY);
        }}
      >
        ···
      </button>
    </div>
  );
}
