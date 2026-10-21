import { ACCENTS, BACKGROUNDS, DENSITIES, FONTS, THEMES } from "../data";
import { useApp } from "../state";
import { IconClose } from "./icons";

export function SettingsSheet() {
  const { settings, settingsOpen, setSettingsOpen, patchSettings, resetSettings, resetLocal, connection, accountName, logout } =
    useApp();
  if (!settingsOpen) return null;

  return (
    <aside className="sheet" role="dialog" aria-label="Настройки">
      <header>
        <h2>Внешний вид</h2>
        <button type="button" className="icon-button" aria-label="Закрыть настройки" onClick={() => setSettingsOpen(false)}>
          <IconClose />
        </button>
      </header>
      <p className="hint">
        {connection === "live"
          ? `${accountName ? `${accountName}. ` : ""}Чаты приходят из Aitu. Папки и оформление остаются на этом компьютере.`
          : "Сообщения хранятся на этом компьютере и пока не уходят в Aitu."}
      </p>

      <section>
        <h3>Тема</h3>
        <div className="segment" role="radiogroup" aria-label="Тема">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              aria-pressed={settings.theme === theme.id}
              onClick={() => patchSettings({ theme: theme.id })}
            >
              {theme.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Акцент</h3>
        <div className="swatches">
          {ACCENTS.map((color) => (
            <button
              key={color}
              type="button"
              className="swatch"
              style={{ background: color }}
              aria-label={color}
              aria-pressed={settings.accent.toLowerCase() === color}
              onClick={() => patchSettings({ accent: color })}
            />
          ))}
          <label className="color-input">
            <span className="sr">Свой цвет</span>
            <input
              type="color"
              value={settings.accent}
              aria-label="Свой цвет акцента"
              onChange={(event) => patchSettings({ accent: event.target.value })}
            />
          </label>
        </div>
      </section>

      <section>
        <h3>Шрифт</h3>
        <select
          value={settings.fontFamily}
          aria-label="Шрифт"
          onChange={(event) => patchSettings({ fontFamily: event.target.value })}
        >
          {FONTS.map((font) => (
            <option key={font.id} value={font.id}>
              {font.label}
            </option>
          ))}
        </select>
      </section>

      <section>
        <h3>Размер шрифта</h3>
        <div className="slider">
          <input
            type="range"
            min={13}
            max={20}
            step={1}
            value={settings.fontSize}
            aria-label="Размер шрифта"
            onChange={(event) => patchSettings({ fontSize: Number(event.target.value) })}
          />
          <span>{settings.fontSize}</span>
        </div>
      </section>

      <section>
        <h3>Плотность</h3>
        <div className="segment three" role="radiogroup" aria-label="Плотность">
          {DENSITIES.map((density) => (
            <button
              key={density.id}
              type="button"
              aria-pressed={settings.density === density.id}
              onClick={() => patchSettings({ density: density.id })}
            >
              {density.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Фон чата</h3>
        <div className="bg-choices">
          {BACKGROUNDS.map((background) => (
            <button
              key={background.id}
              type="button"
              className={`bg-choice bg-${background.id}`}
              aria-pressed={settings.chatBg === background.id}
              onClick={() => patchSettings({ chatBg: background.id })}
            >
              <span>{background.label}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="sheet-actions">
        <button type="button" className="ghost" onClick={resetSettings}>
          Сбросить вид
        </button>
        <button type="button" className="text-danger" onClick={resetLocal}>
          Очистить локальные данные
        </button>
        {connection === "live" && (
          <button type="button" className="text-danger" onClick={logout}>
            Выйти из Aitu
          </button>
        )}
      </div>
    </aside>
  );
}
