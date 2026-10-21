import { useEffect, useState } from "react";
import { useApp } from "../state";
import type { FolderDraft } from "../types";

export function FolderEditor() {
  const { chats, folderDraft, closeFolderEditor, saveFolder, deleteFolder } = useApp();
  const [draft, setDraft] = useState<FolderDraft | null>(folderDraft);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(folderDraft);
    setError(null);
  }, [folderDraft]);

  if (!folderDraft) return null;
  const current = draft && draft.id === folderDraft.id ? draft : folderDraft;

  function update(next: FolderDraft) {
    setDraft(next);
    setError(null);
  }

  return (
    <div
      className="backdrop"
      onMouseDown={closeFolderEditor}
    >
      <form
        className="modal"
        role="dialog"
        aria-label={current.id ? "Изменить папку" : "Новая папка"}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          setError(saveFolder(current));
        }}
      >
        <h2>{current.id ? "Папка" : "Новая папка"}</h2>
        <label className="field">
          Название
          <input
            autoFocus
            maxLength={24}
            value={current.name}
            onChange={(event) => update({ ...current, name: event.target.value })}
          />
        </label>
        <fieldset>
          <legend>Чаты в папке</legend>
          <div className="check-list">
            {chats.map((chat) => {
              const checked = current.chatIds.includes(chat.id);
              return (
                <label key={chat.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      update({
                        ...current,
                        chatIds: checked
                          ? current.chatIds.filter((id) => id !== chat.id)
                          : [...current.chatIds, chat.id],
                      })
                    }
                  />
                  {chat.title}
                </label>
              );
            })}
          </div>
        </fieldset>
        {error && <p className="form-error">{error}</p>}
        <footer>
          {current.id && (
            <button type="button" className="text-danger" onClick={() => deleteFolder(current.id!)}>
              Удалить
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="ghost" onClick={closeFolderEditor}>
            Отмена
          </button>
          <button type="submit" className="primary">
            Сохранить
          </button>
        </footer>
      </form>
    </div>
  );
}
