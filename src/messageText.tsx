import { type MouseEvent, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { explain, inDesktop } from "./api";

const URL_RE =
  /(?<![\p{L}\p{N}_@./])(?:(?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)+[a-z]{2,24}(?:\/[^\s<>"']*)?)/giu;

const TRAILING = /[.,;:!?…»"'“”‘’*_~]+$/u;

const FILE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "mp4",
  "mp3",
  "wav",
  "ogg",
  "pdf",
  "zip",
  "rar",
  "7z",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "json",
  "xml",
  "csv",
  "apk",
  "exe",
  "dmg",
  "iso",
  "md",
  "ts",
  "tsx",
  "js",
  "css",
  "html",
  "wasm",
]);

export function MessageText({ text }: { text: string }) {
  return <>{linkParts(text)}</>;
}

function linkParts(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const raw = match[0];
    if (start > cursor) nodes.push(text.slice(cursor, start));
    const { url, trail } = peel(raw);
    const href = safeHref(url);
    if (href && !looksLikeBareFile(url)) {
      nodes.push(
        <a
          key={start}
          href={href}
          className="msg-link"
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => openInBrowser(event, href)}
          onAuxClick={(event) => {
            if (event.button === 1) openInBrowser(event, href);
          }}
        >
          {url}
        </a>,
      );
    } else {
      nodes.push(url);
    }
    if (trail) nodes.push(trail);
    cursor = start + raw.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.length > 0 ? nodes : text;
}

function peel(raw: string): { url: string; trail: string } {
  let url = raw;
  let trail = "";
  while (url) {
    const closer = url[url.length - 1];
    const opener = closer === ")" ? "(" : closer === "]" ? "[" : closer === "}" ? "{" : "";
    if (opener && countChar(url, closer) > countChar(url, opener)) {
      trail = closer + trail;
      url = url.slice(0, -1);
      continue;
    }
    const trailing = url.match(TRAILING);
    if (trailing && trailing[0].length < url.length) {
      trail = trailing[0] + trail;
      url = url.slice(0, -trailing[0].length);
      continue;
    }
    break;
  }
  return { url, trail };
}

function safeHref(url: string): string | null {
  if (!url) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function looksLikeBareFile(url: string): boolean {
  if (/^https?:\/\//i.test(url) || /^www\./i.test(url)) return false;
  const host = url.split(/[/?#]/)[0];
  const parts = host.split(".");
  return parts.length === 2 && FILE_EXT.has(parts[1].toLowerCase());
}

function countChar(value: string, char: string): number {
  let count = 0;
  for (const item of value) if (item === char) count += 1;
  return count;
}

function openInBrowser(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (!inDesktop) return;
  event.preventDefault();
  void openUrl(href).catch((error) => window.alert(explain(error)));
}
