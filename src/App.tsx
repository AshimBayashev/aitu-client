import { useEffect } from "react";
import { fontStack } from "./data";
import { ChatColumn } from "./components/ChatColumn";
import { FolderColumn } from "./components/FolderColumn";
import { FolderEditor } from "./components/FolderEditor";
import { SettingsSheet } from "./components/SettingsSheet";
import { Thread } from "./components/Thread";
import { AppProvider, useApp } from "./state";

function Shell() {
  const { settings, settingsOpen, folderDraft, setSettingsOpen, closeFolderEditor } = useApp();

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.density = settings.density;
    document.documentElement.style.setProperty("--accent", settings.accent);
    document.documentElement.style.setProperty("--font", fontStack(settings.fontFamily));
    document.documentElement.style.fontSize = `${settings.fontSize}px`;
  }, [settings]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (folderDraft) closeFolderEditor();
      else if (settingsOpen) setSettingsOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [folderDraft, settingsOpen, closeFolderEditor, setSettingsOpen]);

  return (
    <div className="shell">
      <FolderColumn />
      <ChatColumn />
      <Thread />
      <SettingsSheet />
      <FolderEditor />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
