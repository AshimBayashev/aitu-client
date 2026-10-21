import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { explain, inDesktop, mediaSrc, openAttachment } from "../api";
import { chatSubtitle, formatStamp } from "../data";
import { MessageText } from "../messageText";
import { useApp } from "../state";
import type { ChatFile, Message, MessageReply } from "../types";
import { formatVoiceTime, isVoiceFile, MAX_VOICE_MS, MIN_VOICE_MS, preferredAudioMime, toVoiceWav, voicePreview } from "../voice";
import { Avatar } from "./Avatar";
import { ChatProfile } from "./ChatProfile";
import { EmojiPicker } from "./EmojiPicker";
import { IconCheck, IconClip, IconClose, IconMic, IconPause, IconPlay, IconSend, IconSmile } from "./icons";

function sameBurst(earlier: Message | undefined, later: Message | undefined) {
  if (!earlier || !later) return false;
  if (earlier.outgoing !== later.outgoing || earlier.author !== later.author) return false;
  const gap = later.sentAt - earlier.sentAt;
  return gap >= 0 && gap < 5 * 60_000;
}

function replyQuote(message: Message, title: string): MessageReply {
  const author = message.outgoing ? "Вы" : message.author || title;
  const flat = message.text.replace(/\s+/g, " ").trim();
  const file = message.files?.[0];
  const label =
    flat ||
    (file
      ? voicePreview(file.name) ||
        (file.kind === "image" || file.kind === "gif"
          ? "Фото"
          : file.kind === "video"
            ? "Видео"
            : file.kind === "audio" || file.kind === "music"
              ? "Аудио"
              : file.name || "Файл")
      : "") ||
    "Сообщение";
  const chars = [...label];
  return { id: message.id, author, text: chars.length > 140 ? `${chars.slice(0, 140).join("")}…` : label };
}

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
    sendVoice,
  } = useApp();
  const chat = chats.find((item) => item.id === activeChatId) ?? null;
  const items = chat ? (messages[chat.id] ?? []) : [];
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recordHint, setRecordHint] = useState("");
  const [reply, setReply] = useState<MessageReply | null>(null);
  const [menu, setMenu] = useState<{ id: string; left: number; top: number } | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const replyRef = useRef<MessageReply | null>(null);
  const seenChatRef = useRef(activeChatId);
  replyRef.current = reply;
  if (seenChatRef.current !== activeChatId) {
    seenChatRef.current = activeChatId;
    stickRef.current = true;
  }
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);
  const timerRef = useRef(0);
  const finishingRef = useRef(false);
  const recordingRef = useRef(false);
  const cancelledRef = useRef(false);
  const chatIdRef = useRef<string | null>(null);
  chatIdRef.current = chat?.id ?? null;

  function stopTracks() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function discardRecording() {
    cancelledRef.current = true;
    window.clearInterval(timerRef.current);
    recordingRef.current = false;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive" && !finishingRef.current) {
      recorder.onstop = () => stopTracks();
      recorder.stop();
    } else if (!finishingRef.current) {
      stopTracks();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    finishingRef.current = false;
    setRecording(false);
    setElapsed(0);
  }

  async function finishRecording(send: boolean) {
    const recorder = recorderRef.current;
    if (!recorder || finishingRef.current) return;
    finishingRef.current = true;
    cancelledRef.current = false;
    window.clearInterval(timerRef.current);
    const elapsedMs = Date.now() - startedRef.current;
    const chatId = chatIdRef.current;
    const blob = await new Promise<Blob>((resolve) => {
      const type = recorder.mimeType || "audio/webm";
      const done = () => resolve(new Blob(chunksRef.current, { type }));
      if (recorder.state === "inactive") {
        done();
        return;
      }
      recorder.onstop = done;
      recorder.stop();
    });
    stopTracks();
    recorderRef.current = null;
    chunksRef.current = [];
    recordingRef.current = false;
    finishingRef.current = false;
    setRecording(false);
    setElapsed(0);
    if (cancelledRef.current || !send || !chatId || blob.size === 0) return;
    if (elapsedMs < MIN_VOICE_MS) {
      setRecordHint("Слишком короткая запись");
      return;
    }
    let voice = blob;
    try {
      voice = await toVoiceWav(blob);
    } catch {
      voice = blob;
    }
    if (cancelledRef.current) return;
    stickRef.current = true;
    sendVoice(chatId, voice, replyRef.current ?? undefined);
    setReply(null);
  }

  async function startRecording() {
    if (recordingRef.current || files.length > 0) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecordHint("Запись здесь недоступна");
      return;
    }
    cancelledRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mime = preferredAudioMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      startedRef.current = Date.now();
      recordingRef.current = true;
      finishingRef.current = false;
      setRecordHint("");
      setPickerOpen(false);
      setElapsed(0);
      setRecording(true);
      recorder.start();
      timerRef.current = window.setInterval(() => {
        const next = Date.now() - startedRef.current;
        setElapsed(next);
        if (next >= MAX_VOICE_MS) void finishRecording(true);
      }, 200);
    } catch {
      stopTracks();
      recordingRef.current = false;
      setRecording(false);
      setRecordHint("Нет доступа к микрофону");
    }
  }

  useEffect(() => {
    setDraft("");
    setFiles([]);
    setPickerOpen(false);
    setRecordHint("");
    setReply(null);
    setMenu(null);
    stickRef.current = true;
    discardRecording();
  }, [activeChatId]);

  useEffect(() => () => discardRecording(), []);

  useEffect(() => {
    if (!recording) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") discardRecording();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording]);

  useEffect(() => {
    if (!profileOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setProfileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [profileOpen]);

  function pinBottom() {
    const node = bodyRef.current;
    if (!node || !stickRef.current) return;
    node.scrollTop = node.scrollHeight;
  }

  useLayoutEffect(() => {
    pinBottom();
  }, [activeChatId, items, profileOpen]);

  useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    let fromUser = false;
    const mark = () => {
      fromUser = true;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target === node) mark();
    };
    const onScroll = () => {
      if (!fromUser) return;
      fromUser = false;
      const gap = node.scrollHeight - node.scrollTop - node.clientHeight;
      stickRef.current = gap < 80;
    };
    const content = node.querySelector(".messages");
    const observer = new ResizeObserver(() => pinBottom());
    if (content) observer.observe(content);
    node.addEventListener("wheel", mark, { passive: true });
    node.addEventListener("touchmove", mark, { passive: true });
    node.addEventListener("pointerdown", onPointerDown);
    node.addEventListener("scroll", onScroll, { passive: true });
    const frame = requestAnimationFrame(() => pinBottom());
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      node.removeEventListener("wheel", mark);
      node.removeEventListener("touchmove", mark);
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("scroll", onScroll);
    };
  }, [activeChatId]);

  useEffect(() => {
    if (!menu && !reply) return;
    const closeMenu = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menu) {
        setMenu(null);
        return;
      }
      if (!recording && !profileOpen && !pickerOpen) setReply(null);
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, pickerOpen, profileOpen, recording, reply]);

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
    stickRef.current = true;
    sendMessage(chat.id, text, files, reply ?? undefined);
    setDraft("");
    setFiles([]);
    setReply(null);
    setPickerOpen(false);
  }

  function openMessageMenu(message: Message, x: number, y: number) {
    if (message.delivery !== "sent") return;
    const width = 180;
    const height = 48;
    setMenu({
      id: message.id,
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }

  function beginReply(id: string) {
    const message = items.find((item) => item.id === id);
    if (!message || !chat) return;
    setReply(replyQuote(message, chat.title));
    setMenu(null);
    requestAnimationFrame(() => areaRef.current?.focus());
  }

  function showReply(id: string) {
    if (!id) return;
    const node = document.getElementById(`msg-${id}`);
    if (!node) return;
    stickRef.current = false;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    node.classList.remove("msg-flash");
    void node.offsetWidth;
    node.classList.add("msg-flash");
    window.setTimeout(() => node.classList.remove("msg-flash"), 1200);
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
              <h2>Aitu здорового человека</h2>
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
  const canSend = recording || Boolean(draft.trim()) || files.length > 0;

  return (
    <section className="thread">
      <div className="thread-main">
      <header className="thread-head">
        <button
          type="button"
          className="thread-identity"
          aria-expanded={profileOpen}
          aria-label={`Информация о чате ${chat.title}`}
          onClick={() => setProfileOpen((opened) => !opened)}
        >
          <Avatar title={chat.title} fileId={chat.avatar} />
          <div className="who">
            <h2>{chat.title}</h2>
            <p className={subtitle.online ? "online" : undefined}>{subtitle.text}</p>
          </div>
        </button>
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
      <div className={`thread-body bg-${settings.chatBg}`} ref={bodyRef}>
        <div className="messages">
          {connection === "live" && !historyReady[chat.id] && <p className="empty-copy">Загружаем сообщения…</p>}
          {historyError && <p className="login-error history-error">{historyError}</p>}
          {items.map((message, index) => {
            const grouped = sameBurst(items[index - 1], message);
            const continues = sameBurst(message, items[index + 1]);
            return (
              <article
                key={message.id}
                id={`msg-${message.id}`}
                className={[
                  "msg",
                  message.outgoing ? "out" : "in",
                  grouped ? "grouped" : "group-start",
                  continues ? "continues" : "",
                ].join(" ")}
                onContextMenu={(event) => {
                  if (event.target instanceof Element && event.target.closest("a")) return;
                  event.preventDefault();
                  openMessageMenu(message, event.clientX, event.clientY);
                }}
              >
                <div className="bubble">
                  {message.author && !grouped && <span className="author">{message.author}</span>}
                  {message.reply && (
                    <button
                      type="button"
                      className="reply"
                      onClick={() => showReply(message.reply?.id ?? "")}
                    >
                      {message.reply.author && <span className="reply-author">{message.reply.author}</span>}
                      <span className="reply-text">{message.reply.text || "Сообщение"}</span>
                    </button>
                  )}
                  {(message.files ?? []).map((file) => (
                    <Attachment key={`${file.id}:${file.name}`} file={file} />
                  ))}
                  {message.text && (
                    <p>
                      <MessageText text={message.text} />
                    </p>
                  )}
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
        </div>
      </div>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (recordingRef.current) {
            void finishRecording(true);
            return;
          }
          submit();
        }}
      >
        {reply && (
          <div className="composer-reply">
            <span className="reply-author">{reply.author}</span>
            <span className="reply-text">{reply.text}</span>
            <button type="button" aria-label="Отменить ответ" onClick={() => setReply(null)}>
              <IconClose />
            </button>
          </div>
        )}
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
        {recordHint && <p className="composer-hint">{recordHint}</p>}
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
          disabled={recording}
          onClick={() => setPickerOpen((opened) => !opened)}
        >
          <IconSmile />
        </button>
        {recording && (
          <button type="button" className="icon-button" aria-label="Отменить запись" onClick={discardRecording}>
            <IconClose />
          </button>
        )}
        {recording ? (
          <div className="voice-record" role="status">
            <span className="voice-dot" />
            <time>{formatVoiceTime(elapsed)}</time>
            <span>запись, до 3 минут</span>
          </div>
        ) : (
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
              if (event.key === "Escape") {
                if (pickerOpen) setPickerOpen(false);
                else setReply(null);
              }
            }}
          />
        )}
            <button
              type={canSend ? "submit" : "button"}
              className="send"
              aria-label={recording ? "Отправить голосовое" : canSend ? "Отправить" : "Записать голосовое"}
              onClick={canSend ? undefined : () => void startRecording()}
            >
              <span key={canSend ? "send" : "mic"} className="send-icon">
                {canSend ? <IconSend /> : <IconMic />}
              </span>
            </button>
      </form>
      </div>
      {menu && (
        <div
          className="menu msg-menu"
          style={{ left: menu.left, top: menu.top }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => beginReply(menu.id)}>
            Ответить
          </button>
        </div>
      )}
      <ChatProfile
        chat={chat}
        messages={items}
        historyReady={connection !== "live" || Boolean(historyReady[chat.id])}
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
      />
    </section>
  );
}

function Attachment({ file }: { file: ChatFile }) {
  const [broken, setBroken] = useState(false);
  const visual = file.id && !broken && (file.kind === "image" || file.kind === "gif");
  const playable = file.id && !broken && (file.kind === "video" || file.kind === "audio" || file.kind === "music");
  const src = file.id ? mediaSrc(file.id) : "";
  if (isVoiceFile(file)) {
    return <VoiceNote src={file.localUrl || src} />;
  }

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

function VoiceNote({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  function toggle() {
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (audio.paused) {
      if (audio.ended) audio.currentTime = 0;
      void audio.play().catch(() => setPlaying(false));
      return;
    }
    audio.pause();
  }

  return (
    <div className="voice">
      <button type="button" className="voice-play" aria-label={playing ? "Пауза" : "Слушать"} onClick={toggle} disabled={!src}>
        {playing ? <IconPause /> : <IconPlay />}
      </button>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={duration ? Math.min(time, duration) : 0}
        aria-label="Позиция голосового"
        disabled={!src || !duration}
        onChange={(event) => {
          const next = Number(event.target.value);
          const audio = audioRef.current;
          if (audio) audio.currentTime = next;
          setTime(next);
        }}
      />
      <time>{formatVoiceTime((playing || time > 0 ? time : duration) * 1000)}</time>
      <audio
        ref={audioRef}
        src={src || undefined}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
      />
    </div>
  );
}
