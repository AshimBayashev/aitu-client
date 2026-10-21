import type {
  Chat,
  ChatBg,
  Density,
  EmojiCategory,
  Folder,
  Message,
  Settings,
  ThemeName,
} from "./types";

export const CHATS: Chat[] = [
  { id: "aigerim", title: "Айгерим", kind: "direct", pinned: true, presence: "online" },
  { id: "team", title: "Команда", kind: "group", pinned: true, members: 8 },
  { id: "mom", title: "Мама", kind: "direct", pinned: false, presence: "recent" },
  { id: "news", title: "Новости Астаны", kind: "channel", pinned: false },
  { id: "daniyar", title: "Данияр", kind: "direct", pinned: false, presence: "recent" },
  { id: "design", title: "Дизайн", kind: "group", pinned: false, members: 4 },
  { id: "family", title: "Семья", kind: "group", pinned: false, members: 5 },
];

export const FONTS = [
  { id: "Segoe UI", label: "Segoe UI", stack: '"Segoe UI", sans-serif' },
  { id: "Bahnschrift", label: "Bahnschrift", stack: "Bahnschrift, sans-serif" },
  { id: "Calibri", label: "Calibri", stack: "Calibri, sans-serif" },
  { id: "Georgia", label: "Georgia", stack: "Georgia, serif" },
  { id: "Cambria", label: "Cambria", stack: "Cambria, serif" },
  { id: "Consolas", label: "Consolas", stack: "Consolas, monospace" },
] as const;

export const ACCENTS = ["#3d8bfd", "#2a9d8f", "#e07a4f", "#c45c8a", "#7c6af7", "#d4a017"];

export const BACKGROUNDS: { id: ChatBg; label: string }[] = [
  { id: "plain", label: "Ровный" },
  { id: "mist", label: "Дымка" },
  { id: "dusk", label: "Сумерки" },
  { id: "paper", label: "Бумага" },
  { id: "grid", label: "Сетка" },
];

export const DENSITIES: { id: Density; label: string }[] = [
  { id: "compact", label: "Компактно" },
  { id: "cozy", label: "Обычно" },
  { id: "relaxed", label: "Свободно" },
];

export const THEMES: { id: ThemeName; label: string }[] = [
  { id: "light", label: "Светлая" },
  { id: "dark", label: "Тёмная" },
];

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  accent: "#3d8bfd",
  fontFamily: "Segoe UI",
  fontSize: 15,
  density: "cozy",
  chatBg: "mist",
};

export function seedFolders(): Folder[] {
  return [
    { id: "all", name: "Все", chatIds: null, locked: true },
    { id: "personal", name: "Личные", chatIds: ["aigerim", "mom", "daniyar", "family"] },
    { id: "work", name: "Работа", chatIds: ["team", "design"] },
    { id: "channels", name: "Каналы", chatIds: ["news"] },
  ];
}

export function seedUnread(): Record<string, number> {
  return { news: 4, design: 1 };
}

function message(
  chatId: string,
  minutesAgo: number,
  text: string,
  outgoing: boolean,
  now: number,
  author?: string,
): Message {
  return {
    id: `${chatId}-${minutesAgo}`,
    chatId,
    outgoing,
    text,
    sentAt: now - minutesAgo * 60_000,
    delivery: "sent",
    author,
  };
}

export function seedMessages(now = Date.now()): Record<string, Message[]> {
  return {
    aigerim: [
      message("aigerim", 48, "Ты на связи? Хочу скинуть адрес.", false, now),
      message("aigerim", 46, "Да, кидай.", true, now),
      message("aigerim", 44, "Абая 10, подъезд 2. Буду через полчаса.", false, now),
      message("aigerim", 42, "Ок, выхожу 👍", true, now),
    ],
    team: [
      message("team", 180, "Макет на главную обновила.", false, now, "Асель"),
      message("team", 150, "Гляну после обеда.", false, now, "Ерлан"),
      message("team", 20, "Я поправлю список чатов сегодня.", true, now),
    ],
    mom: [
      message("mom", 300, "Позвони, как освободишься.", false, now),
      message("mom", 280, "Хорошо, ближе к вечеру.", true, now),
    ],
    news: [
      message("news", 90, "Сегодня в Астане без осадков, днём до +12.", false, now),
      message("news", 30, "Вечером на правом берегу перекроют проспект на час.", false, now),
    ],
    daniyar: [
      message("daniyar", 1400, "Го на выходных в горы?", false, now),
      message("daniyar", 1380, "Если погода не сорвётся — да.", true, now),
    ],
    design: [
      message("design", 70, "Шрифт в карточках слишком мелкий.", false, now, "Камила"),
      message("design", 15, "Увеличу и добавлю настройку размера.", true, now),
    ],
    family: [
      message("family", 400, "Во сколько ужин?", false, now, "Папа"),
      message("family", 390, "В семь буду.", true, now),
    ],
  };
}

export const EMOJI: EmojiCategory[] = [
  {
    id: "smile",
    label: "Смайлы",
    items: [
      { char: "😀", name: "улыбка радость" },
      { char: "😁", name: "смех зубы" },
      { char: "😂", name: "смех слёзы" },
      { char: "🤣", name: "ржака" },
      { char: "😊", name: "улыбка тепло" },
      { char: "😇", name: "ангел" },
      { char: "🙂", name: "спокойно" },
      { char: "😉", name: "подмигивание" },
      { char: "😍", name: "влюблён" },
      { char: "😘", name: "поцелуй" },
      { char: "😗", name: "чмок" },
      { char: "😋", name: "вкусно" },
      { char: "😛", name: "язык" },
      { char: "😜", name: "дразнит" },
      { char: "🤪", name: "безумие" },
      { char: "😎", name: "круто очки" },
      { char: "🤓", name: "очки умный" },
      { char: "🧐", name: "монокль" },
      { char: "😏", name: "ухмылка" },
      { char: "😒", name: "скука" },
      { char: "🙄", name: "закатил глаза" },
      { char: "😬", name: "гримаса" },
      { char: "😔", name: "грусть" },
      { char: "😢", name: "слёзы плачет" },
      { char: "😭", name: "рыдает" },
      { char: "😤", name: "злость" },
      { char: "😡", name: "злой" },
      { char: "🤯", name: "взрыв мозг" },
      { char: "😳", name: "смущение" },
      { char: "🥺", name: "умоляет" },
      { char: "😴", name: "сон" },
      { char: "🤔", name: "думает" },
      { char: "🤗", name: "обнимает" },
      { char: "🤭", name: "хихикает" },
      { char: "🤫", name: "тихо" },
      { char: "😐", name: "нейтрально" },
    ],
  },
  {
    id: "hands",
    label: "Жесты",
    items: [
      { char: "👍", name: "класс палец вверх" },
      { char: "👎", name: "палец вниз" },
      { char: "👌", name: "ок" },
      { char: "✌️", name: "победа мир" },
      { char: "🤞", name: "удача" },
      { char: "🤟", name: "люблю" },
      { char: "🤘", name: "рок" },
      { char: "👏", name: "аплодисменты" },
      { char: "🙌", name: "ура руки" },
      { char: "👐", name: "ладони" },
      { char: "🤝", name: "рукопожатие" },
      { char: "🙏", name: "спасибо молитва" },
      { char: "💪", name: "сила" },
      { char: "👋", name: "привет пока" },
      { char: "🤙", name: "позвони" },
      { char: "👀", name: "глаза смотрю" },
      { char: "🧠", name: "мозг" },
      { char: "💋", name: "поцелуй губы" },
    ],
  },
  {
    id: "hearts",
    label: "Сердца",
    items: [
      { char: "❤️", name: "сердце любовь" },
      { char: "🧡", name: "оранжевое сердце" },
      { char: "💛", name: "жёлтое сердце" },
      { char: "💚", name: "зелёное сердце" },
      { char: "💙", name: "синее сердце" },
      { char: "💜", name: "фиолетовое сердце" },
      { char: "🖤", name: "чёрное сердце" },
      { char: "🤍", name: "белое сердце" },
      { char: "💔", name: "разбитое сердце" },
      { char: "❣️", name: "восклицание сердце" },
      { char: "💕", name: "два сердца" },
      { char: "💞", name: "кружатся сердца" },
      { char: "💓", name: "бьётся сердце" },
      { char: "💗", name: "растущее сердце" },
      { char: "💖", name: "сверкающее сердце" },
      { char: "💘", name: "стрела сердце" },
      { char: "💝", name: "сердце подарок" },
      { char: "💟", name: "сердце украшение" },
    ],
  },
  {
    id: "nature",
    label: "Природа",
    items: [
      { char: "☀️", name: "солнце" },
      { char: "🌙", name: "луна" },
      { char: "⭐", name: "звезда" },
      { char: "🌟", name: "сияние" },
      { char: "✨", name: "искры" },
      { char: "⚡", name: "молния" },
      { char: "🔥", name: "огонь" },
      { char: "💧", name: "капля" },
      { char: "🌈", name: "радуга" },
      { char: "❄️", name: "снег" },
      { char: "🌸", name: "цветок сакура" },
      { char: "🌹", name: "роза" },
      { char: "🌺", name: "гибискус" },
      { char: "🌻", name: "подсолнух" },
      { char: "🌿", name: "лист" },
      { char: "🍀", name: "клевер удача" },
      { char: "🌳", name: "дерево" },
      { char: "🌊", name: "волна" },
    ],
  },
  {
    id: "food",
    label: "Еда",
    items: [
      { char: "☕", name: "кофе" },
      { char: "🍵", name: "чай" },
      { char: "🥐", name: "круассан" },
      { char: "🍞", name: "хлеб" },
      { char: "🍎", name: "яблоко" },
      { char: "🍓", name: "клубника" },
      { char: "🍉", name: "арбуз" },
      { char: "🍋", name: "лимон" },
      { char: "🍕", name: "пицца" },
      { char: "🍔", name: "бургер" },
      { char: "🍟", name: "картошка" },
      { char: "🍜", name: "лапша" },
      { char: "🍣", name: "суши" },
      { char: "🍰", name: "торт" },
      { char: "🍫", name: "шоколад" },
      { char: "🍷", name: "вино" },
      { char: "🍺", name: "пиво" },
      { char: "🥂", name: "бокалы праздник" },
    ],
  },
  {
    id: "marks",
    label: "Знаки",
    items: [
      { char: "✅", name: "галочка готово" },
      { char: "❌", name: "крест нет" },
      { char: "❓", name: "вопрос" },
      { char: "❗", name: "важно" },
      { char: "💯", name: "сто" },
      { char: "🎉", name: "праздник" },
      { char: "🎊", name: "конфетти" },
      { char: "🎁", name: "подарок" },
      { char: "📌", name: "кнопка закреп" },
      { char: "📎", name: "скрепка" },
      { char: "📝", name: "заметка" },
      { char: "💬", name: "речь" },
      { char: "🔔", name: "колокол" },
      { char: "🔕", name: "без звука" },
      { char: "🔒", name: "замок" },
      { char: "💡", name: "идея лампа" },
      { char: "🚀", name: "ракета" },
      { char: "🏠", name: "дом" },
    ],
  },
];

const AVATAR_COLORS = ["#3d8bfd", "#2a9d8f", "#e07a4f", "#c45c8a", "#7c6af7", "#d4a017", "#4c9a62"];

export function avatarColor(title: string): string {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function initials(title: string): string {
  const parts = title.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  return title.slice(0, 1).toUpperCase();
}

export function formatStamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function fontStack(fontFamily: string): string {
  return FONTS.find((font) => font.id === fontFamily)?.stack ?? FONTS[0].stack;
}

export function chatSubtitle(chat: Chat): { text: string; online: boolean } {
  if (chat.kind === "direct") {
    if (chat.presence === "online") return { text: "в сети", online: true };
    if (chat.presence === "recent") return { text: "был(а) недавно", online: false };
    if (chat.peerType === "BOT") return { text: "бот", online: false };
    if (chat.peerType === "APP") return { text: "приложение", online: false };
    if (chat.peerType === "BUSINESS_CHAT") return { text: "бизнес", online: false };
    return { text: "личный чат", online: false };
  }
  if (chat.kind === "group") return { text: `${chat.members ?? 0} участников`, online: false };
  return { text: "канал", online: false };
}
