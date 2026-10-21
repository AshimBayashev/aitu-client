import { useEffect, useState } from "react";
import { explain, mediaSrc, openAttachment } from "../api";
import { chatSubtitle } from "../data";
import type { Chat, ChatFile, Message } from "../types";
import { Avatar } from "./Avatar";
import { IconClose } from "./icons";

export function ChatProfile({
  chat,
  messages,
  historyReady,
  open,
  onClose,
}: {
  chat: Chat;
  messages: Message[];
  historyReady: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [present, setPresent] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setPresent(true);
      const frame = requestAnimationFrame(() => {
        requestAnimationFrame(() => setShown(true));
      });
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPresent(false);
  }, [open]);

  if (!present) return null;

  const subtitle = chatSubtitle(chat);
  const media = collectMedia(messages);
  const rows = infoRows(chat);

  return (
    <aside
      className={shown ? "profile" : "profile profile-hidden"}
      role="dialog"
      aria-label={`Информация: ${chat.title}`}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget || event.propertyName !== "width" || open) return;
        setPresent(false);
      }}
    >
      <div className="profile-inner">
      <div className="profile-bar">
        <button type="button" className="icon-button" aria-label="Закрыть информацию" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="profile-scroll">
        <div className="profile-hero">
          <span className="profile-avatar">
            <Avatar title={chat.title} fileId={chat.avatar} size={104} />
          </span>
          <h2>{chat.title}</h2>
          <p className={subtitle.online ? "online" : undefined}>{subtitle.text}</p>
        </div>

        {rows.length > 0 && (
          <section className="profile-card">
            {rows.map((row) => (
              <div key={row.label} className="profile-row">
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </section>
        )}

        <section className="profile-card">
          <h3>Медиа</h3>
          {!historyReady && <p className="profile-empty">Загружаем сообщения…</p>}
          {historyReady && media.total === 0 && <p className="profile-empty">В загруженной переписке пока нет файлов</p>}
          {media.photos.length > 0 && (
            <div className="profile-grid">
              {media.photos.slice(-12).reverse().map((file) => (
                <MediaThumb key={file.id || file.name} file={file} />
              ))}
            </div>
          )}
          <ul className="profile-stats">
            {media.photos.length > 0 && <Stat label={countLabel(media.photos.length, "фото", "фото", "фото")} />}
            {media.videos.length > 0 && <Stat label={countLabel(media.videos.length, "видео", "видео", "видео")} />}
            {media.audios.length > 0 && <Stat label={countLabel(media.audios.length, "аудио", "аудио", "аудио")} />}
            {media.files.length > 0 && <Stat label={countLabel(media.files.length, "файл", "файла", "файлов")} />}
          </ul>
          {media.files.length > 0 && (
            <ul className="profile-files">
              {media.files.slice(-8).reverse().map((file) => (
                <li key={file.id || file.name}>
                  <button type="button" onClick={() => void openFile(file)}>
                    <span>{file.name || "Файл"}</span>
                    {file.size > 0 && <small>{formatBytes(file.size)}</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      </div>
    </aside>
  );
}

function Stat({ label }: { label: string }) {
  return <li>{label}</li>;
}

function MediaThumb({ file }: { file: ChatFile }) {
  const [broken, setBroken] = useState(false);
  if (!file.id || broken) {
    return (
      <button type="button" className="profile-thumb missing" onClick={() => void openFile(file)}>
        {file.kind === "gif" ? "GIF" : "Фото"}
      </button>
    );
  }
  return (
    <button type="button" className="profile-thumb" onClick={() => void openFile(file)}>
      <img src={mediaSrc(file.id)} alt={file.name || "Фото"} onError={() => setBroken(true)} />
    </button>
  );
}

function openFile(file: ChatFile) {
  if (!file.id) return;
  void openAttachment(file.id, file.name || "file").catch((error) => window.alert(explain(error)));
}

function infoRows(chat: Chat): { label: string; value: string }[] {
  if (chat.kind === "channel" && chat.members) {
    return [{ label: "Подписчики", value: countLabel(chat.members, "человек", "человека", "человек") }];
  }
  return [];
}

function collectMedia(messages: Message[]) {
  const photos: ChatFile[] = [];
  const videos: ChatFile[] = [];
  const audios: ChatFile[] = [];
  const files: ChatFile[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    for (const file of message.files ?? []) {
      const key = file.id || `${file.name}:${file.size}:${file.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (file.kind === "image" || file.kind === "gif") photos.push(file);
      else if (file.kind === "video") videos.push(file);
      else if (file.kind === "audio" || file.kind === "music") audios.push(file);
      else if (file.kind !== "sticker") files.push(file);
    }
  }
  return { photos, videos, audios, files, total: photos.length + videos.length + audios.length + files.length };
}

function countLabel(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${count} ${word}`;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
}
