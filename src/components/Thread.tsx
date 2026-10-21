import { useEffect, useRef, useState } from "react";
import { avatarColor, chatSubtitle, formatStamp, initials } from "../data";
import { useApp } from "../state";
import { EmojiPicker } from "./EmojiPicker";
import { IconCheck, IconSend, IconSmile } from "./icons";

export function Thread() {
  const {
    chats,
    messages,
    activeChatId,
    settings,
    sendMessage,
    connection,
    accountName,
    loginError,
    login,
    historyReady,
    historyError,
  } = useApp();
  const chat = chats.find((item) => item.id === activeChatId) ?? null;
  const items = chat ? (messages[chat.id] ?? []) : [];
  const [draft, setDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft("");
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

  function submit() {
    if (!chat) return;
    const text = draft;
    if (!text.trim()) return;
    sendMessage(chat.id, text);
    setDraft("");
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
        <span className="avatar" style={{ background: avatarColor(chat.title) }}>
          {initials(chat.title)}
        </span>
        <div className="who">
          <h2>{chat.title}</h2>
          <p className={subtitle.online ? "online" : undefined}>{subtitle.text}</p>
        </div>
        <span
          className="local-pill"
          title={connection === "live" ? "Сообщения уходят в Aitu" : "Сообщения остаются на этом компьютере"}
        >
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
                  <p>{message.text}</p>
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
        {pickerOpen && <EmojiPicker onPick={insertEmoji} />}
        <button
          type="button"
          className={pickerOpen ? "icon-button active" : "icon-button"}
          aria-label="Смайлики"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((open) => !open)}
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
        <button type="submit" className="send" aria-label="Отправить" disabled={!draft.trim()}>
          <IconSend />
        </button>
      </form>
    </section>
  );
}
