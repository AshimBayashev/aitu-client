import { useApp } from "../state";
import { IconFolder, IconPlus, IconSliders } from "./icons";

export function FolderColumn() {
  const { chats, folders, unread, activeFolderId, setActiveFolder, openCreateFolder, openEditFolder, setSettingsOpen } =
    useApp();

  return (
    <aside className="rail">
      <div className="brand" title="Aitu">
        <span className="brand-mark">A</span>
      </div>
      <nav className="folders" aria-label="Папки чатов">
        {folders
          .filter((folder) => {
            if (folder.id === "all") return true;
            if (folder.locked) return (folder.chatIds?.length ?? 0) > 0;
            const ids = folder.chatIds ?? [];
            return ids.length === 0 || ids.some((id) => chats.some((chat) => chat.id === id));
          })
          .map((folder) => {
          const ids = folder.chatIds ?? chats.map((chat) => chat.id);
          const badge = ids.reduce((sum, id) => sum + (unread[id] ?? 0), 0);
          return (
            <div key={folder.id} className={folder.id === activeFolderId ? "folder active" : "folder"}>
              <button
                type="button"
                className="folder-main"
                title={folder.locked ? folder.name : `${folder.name}. Правый клик изменяет папку`}
                onClick={() => setActiveFolder(folder.id)}
                onContextMenu={(event) => {
                  if (folder.locked) return;
                  event.preventDefault();
                  openEditFolder(folder.id);
                }}
              >
                <span className="folder-glyph">
                  <IconFolder />
                  {badge > 0 && <span className="badge folder-badge">{badge > 99 ? "99+" : badge}</span>}
                </span>
                <span className="folder-name">{folder.name}</span>
              </button>
            </div>
          );
        })}
      </nav>
      <div className="rail-tools">
        <button type="button" className="rail-tool" aria-label="Новая папка" title="Новая папка" onClick={openCreateFolder}>
          <IconPlus />
        </button>
        <button type="button" className="rail-tool" aria-label="Настройки" title="Настройки" onClick={() => setSettingsOpen(true)}>
          <IconSliders />
        </button>
      </div>
    </aside>
  );
}
