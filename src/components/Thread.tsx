import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { explain, inDesktop, mediaSrc, openAttachment } from "../api";
import { chatSubtitle, formatStamp } from "../data";
import { Avatar } from "./Avatar";
import { useApp } from "../state";
import type { ChatFile } from "../types";
import { EmojiPicker } from "./EmojiPicker";
import { IconCheck, IconClip, IconSend, IconSmile } from "./icons";

export function Thread() {
  const {
    chats,
    messages,
    activeChatId,
    settings,
    sendMessage,
    connection,
    accountName,
    accountAvatar,
    loginError,
    login,
    historyReady,
    historyError,
  } = useApp();
  const chat = chats.find((item) => item.id === activeChatId) ?? null;
  const items = chat ? (messages[chat.id] ?? []) : [];
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft("");
    setFiles([]);
    setPickerOpen(false);
  }, [activeChatId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [activeChatId, items.length, items[items.length - 1]?.delivery]);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "0px";
    area.style.height = `${Math.min(area.scrollHeight, 140)}px`;
  }, [draft, activeChatId]);

  function insertEmoji(char: string) {
    const area = areaRef.current;
    const start = area?.selectionStart ?? draft.length;
    const end = area?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + char + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      if (!area) return;
      const position = start + char.length;
      area.focus();
      area.setSelectionRange(position, position);
    });
  }

  async function attach() {
    const picked = await open({ multiple: true, title: "Файлы" });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    setFiles((current) => [...current, ...paths.filter((path) => !current.includes(path))]);
  }

  function submit() {
    if (!chat) return;
    const text = draft;
    if (!text.trim() && files.length === 0) return;
    sendMessage(chat.id, text, files);
    setDraft("");
    setFiles([]);
    setPickerOpen(false);
  }

  if (!chat) {
    const signingIn = connection === "signed-out" || connection === "connecting";
    return (
      <section className="thread">
        <div className="empty-thread">
          {connection === "checking" ? (
            <h2>Подключаемся…</h2>
          ) : signingIn ? (
            <>
              <h2>Войдите в Aitu</h2>
              <p>Откроется окно паспорта. Код из SMS вводите только там.</p>
              {loginError && <p className="login-error">{loginError}</p>}
              <button type="button" className="primary" disabled={connection === "connecting"} onClick={login}>
                {connection === "connecting" ? "Ждём вход…" : "Войти"}
              </button>
            </>
          ) : (
            <>
              <h2>Выберите чат</h2>
              <p>Папки слева раскладывают переписки. Внешний вид меняется в настройках.</p>
            </>
          )}
        </div>
      </section>
    );
  }

  const subtitle = chatSubtitle(chat);

  return (
    <section className="thread">
      <header className="thread-head">
        <Avatar title={chat.title} fileId={chat.avatar} />
        <div className="who">
          <h2>{chat.title}</h2>
          <p className={subtitle.online ? "online" : undefined}>{subtitle.text}</p>
        </div>
        <span
          className="local-pill"
          title={connection === "live" ? "Сообщения уходят в Aitu" : "Сообщения остаются на этом компьютере"}
        >
          {connection === "live" && accountName && (
            <Avatar title={accountName} fileId={accountAvatar} size={22} />
          )}
          {connection === "live" ? accountName || "Aitu" : "Локально"}
        </span>
      </header>
      <div className={`thread-body bg-${settings.chatBg}`}>
        <div className="messages">
          {connection === "live" && !historyReady[chat.id] && <p className="empty-copy">Загружаем сообщения…</p>}
          {historyError && <p className="login-error history-error">{historyError}</p>}
          {items.map((message, index) => {
            const previous = items[index - 1];
            const grouped =
              previous &&
              previous.outgoing === message.outgoing &&
              previous.author === message.author &&
              message.sentAt - previous.sentAt < 5 * 60_000;
            return (
              <article
                key={message.id}
                className={[
                  "msg",
                  message.outgoing ? "out" : "in",
                  grouped ? "grouped" : "group-start",
                ].join(" ")}
              >
                <div className="bubble">
                  {message.author && !grouped && <span className="author">{message.author}</span>}
                  {(message.files ?? []).map((file) => (
                    <Attachment key={`${file.id}:${file.name}`} file={file} />
                  ))}
                  {message.text && <p>{message.text}</p>}
                  <span className="bubble-meta">
                    <time>{formatStamp(message.sentAt)}</time>
                    {message.outgoing && message.delivery === "sending" && (
                      <span className="status-sending" title="отправляется" />
                    )}
                    {message.outgoing && message.delivery === "sent" && (
                      <span className="status-sent" title="отправлено">
                        <IconCheck />
                      </span>
                    )}
                    {message.outgoing && message.delivery === "failed" && (
                      <span className="status-failed">не ушло</span>
                    )}
                  </span>
                </div>
              </article>
            );
          })}
          <div ref={endRef} />
        </div>
      </div>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {files.length > 0 && (
          <div className="pending-files">
            {files.map((path) => (
              <span key={path} className="pending-file">
                {path.split(/[/\\]/).pop()}
                <button type="button" aria-label="Убрать файл" onClick={() => setFiles((current) => current.filter((item) => item !== path))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {pickerOpen && <EmojiPicker onPick={insertEmoji} />}
        {inDesktop && (
          <button type="button" className="icon-button" aria-label="Прикрепить файл" onClick={() => void attach().catch((error) => window.alert(explain(error)))}>
            <IconClip />
          </button>
        )}
        <button
          type="button"
          className={pickerOpen ? "icon-button active" : "icon-button"}
          aria-label="Смайлики"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((opened) => !opened)}
        >
          <IconSmile />
        </button>
        <textarea
          ref={areaRef}
          rows={1}
          value={draft}
          placeholder="Сообщение"
          aria-label="Сообщение"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
            if (event.key === "Escape") setPickerOpen(false);
          }}
        />
        <button type="submit" className="send" aria-label="Отправить" disabled={!draft.trim() && files.length === 0}>
          <IconSend />
        </button>
      </form>
    </section>
  );
}

function Attachment({ file }: { file: ChatFile }) {
  const [broken, setBroken] = useState(false);
  const visual = file.id && !broken && (file.kind === "image" || file.kind === "gif");
  const playable = file.id && !broken && (file.kind === "video" || file.kind === "audio" || file.kind === "music");
  const src = file.id ? mediaSrc(file.id) : "";

  function openFile() {
    if (!file.id) return;
    void openAttachment(file.id, file.name || "file").catch((error) => window.alert(explain(error)));
  }

  if (visual) {
    return (
      <button type="button" className="media-button" onClick={openFile}>
        <img src={src} alt={file.name || "Фото"} onError={() => setBroken(true)} />
      </button>
    );
  }
  if (playable && file.kind === "video") {
    return <video className="media-player" src={src} controls onError={() => setBroken(true)} />;
  }
  if (playable) {
    return <audio className="media-player" src={src} controls onError={() => setBroken(true)} />;
  }
  return (
    <button type="button" className="file-card" onClick={openFile} disabled={!file.id}>
      <span>{file.name || "Файл"}</span>
      {file.size > 0 && <small>{formatBytes(file.size)}</small>}
    </button>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
}
