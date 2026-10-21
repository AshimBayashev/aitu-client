import { useMemo, useState } from "react";
import { EMOJI } from "../data";
import { useApp } from "../state";

export function EmojiPicker({ onPick }: { onPick: (char: string) => void }) {
  const { recentEmoji, rememberEmoji } = useApp();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState(EMOJI[0].id);

  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    if (!needle) return EMOJI.find((category) => category.id === categoryId)?.items ?? [];
    return EMOJI.flatMap((category) => category.items).filter((item) => item.name.includes(needle));
  }, [categoryId, query]);

  function pick(char: string) {
    rememberEmoji(char);
    onPick(char);
  }

  return (
    <div className="picker" role="dialog" aria-label="Смайлики">
      <input
        className="picker-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Найти смайлик"
        aria-label="Найти смайлик"
      />
      {!query && recentEmoji.length > 0 && (
        <div className="picker-recent" aria-label="Недавние">
          {recentEmoji.map((char) => (
            <button key={char} type="button" className="emoji" onClick={() => pick(char)}>
              {char}
            </button>
          ))}
        </div>
      )}
      {!query && (
        <div className="picker-tabs" role="tablist">
          {EMOJI.map((category) => (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={category.id === categoryId}
              onClick={() => setCategoryId(category.id)}
            >
              {category.label}
            </button>
          ))}
        </div>
      )}
      <div className="picker-grid">
        {items.length === 0 && <p className="menu-empty">Ничего не нашлось</p>}
        {items.map((item) => (
          <button key={item.char + item.name} type="button" className="emoji" title={item.name} onClick={() => pick(item.char)}>
            {item.char}
          </button>
        ))}
      </div>
    </div>
  );
}
