/** Seed catalog data (Russian). Prices in whole RUB here; seed converts to kopecks. */
import type { ProductType, DeliveryMode, ProductStatus } from "../../src/generated/client";

export interface SeedCategory {
  slug: string;
  name: string;
  icon: string; // lucide-react icon name (kebab-case)
  parent?: string;
  description?: string;
}

export const CATEGORIES: SeedCategory[] = [
  { slug: "igry", name: "Игры", icon: "gamepad-2", description: "Ключи и аккаунты для PC и консолей" },
  { slug: "steam-klyuchi", name: "Steam ключи", icon: "monitor", parent: "igry", description: "Лицензионные ключи Steam" },
  { slug: "xbox", name: "Xbox", icon: "gamepad", parent: "igry", description: "Игры для Xbox и Windows" },
  { slug: "playstation", name: "PlayStation", icon: "gamepad-2", parent: "igry", description: "Игры для PS4 и PS5" },
  { slug: "nintendo", name: "Nintendo", icon: "joystick", parent: "igry", description: "Игры для Nintendo Switch" },
  { slug: "podpiski", name: "Подписки", icon: "repeat", description: "Сервисы по подписке: музыка, кино, ИИ, игры" },
  { slug: "igrovye-podpiski", name: "Игровые подписки", icon: "trophy", parent: "podpiski" },
  { slug: "ai-servisy", name: "ИИ-сервисы", icon: "bot", parent: "podpiski" },
  { slug: "muzyka-i-video", name: "Музыка и видео", icon: "music", parent: "podpiski" },
  { slug: "popolnenie-steam", name: "Пополнение Steam", icon: "wallet", description: "Пополнение кошелька Steam по логину" },
  { slug: "podarochnye-karty", name: "Подарочные карты", icon: "gift", description: "Gift cards популярных магазинов" },
  { slug: "igrovaya-valyuta", name: "Игровая валюта", icon: "coins", description: "Донат и внутриигровая валюта" },
  { slug: "programmy", name: "Программы", icon: "app-window", description: "Windows, Office, антивирусы, VPN" },
];

export interface SeedVariant {
  title: string;
  price: number;
  oldPrice?: number;
  attributes?: Record<string, unknown>;
  providerSku?: string;
}

export interface SeedProduct {
  title: string;
  category: string;
  type: ProductType;
  delivery: DeliveryMode;
  price: number; // RUB, ignored if variants provided (min variant price used)
  oldPrice?: number;
  platform?: string;
  region?: string;
  seller: 0 | 1 | 2;
  blurb: string;
  tags?: string[];
  variants?: SeedVariant[];
  featured?: boolean;
  /** relative popularity weight for generating historical orders */
  weight?: number;
  status?: ProductStatus;
  moderationNote?: string;
  /** number of AVAILABLE stock items to create beyond sold ones (default random 6..18) */
  extraStock?: number;
}

const v = (title: string, price: number, oldPrice?: number, attributes?: Record<string, unknown>, providerSku?: string): SeedVariant => ({
  title, price, oldPrice, attributes, providerSku,
});

export const PRODUCTS: SeedProduct[] = [
  // ───────── Steam ключи ─────────
  { title: "Cyberpunk 2077", category: "steam-klyuchi", type: "KEY", delivery: "AUTO_STOCK", price: 1899, oldPrice: 2999, platform: "STEAM", region: "RU", seller: 1, weight: 9, featured: true,
    blurb: "Культовая RPG в Найт-Сити. Расширение Phantom Liberty продаётся отдельно.", tags: ["rpg", "открытый мир", "cd projekt"] },
  { title: "Elden Ring", category: "steam-klyuchi", type: "KEY", delivery: "AUTO_STOCK", price: 2999, oldPrice: 3999, platform: "STEAM", region: "CIS", seller: 1, weight: 10, featured: true,
    blurb: "Эпическая action-RPG от FromSoftware и Джорджа Мартина.", tags: ["souls-like", "rpg", "fromsoftware"] },
  { title: "Baldur's Gate 3", category: "steam-klyuchi", type: "KEY", delivery: "AUTO_STOCK", price: 2699, platform: "STEAM", region: "CIS", seller: 0, weight: 8, featured: true,
    blurb: "Пошаговая RPG по вселенной Dungeons & Dragons с кооперативом на четверых.", tags: ["rpg", "кооператив", "dnd"] },
  { title: "Hogwarts Legacy", category: "steam-klyuchi", type: "KEY", delivery: "AUTO_STOCK", price: 2299, oldPrice: 3499, platform: "STEAM", region: "CIS", seller: 0, weight: 6,
    blurb: "Приключение в открытом мире Хогвартса конца XIX века.", tags: ["фэнтези", "открытый мир"] },
  { title: "Red Dead Redemption 2", category: "steam-klyuchi", type: "KEY", delivery: "AUTO_STOCK", price: 1799, oldPrice: 3299, platform: "STEAM", region: "CIS", seller: 1, weight: 7, featured: true,
    blurb: "Вестерн от Rockstar Games: банда Датча, Дикий Запад и огромный мир.", tags: ["вестерн", "rockstar", "открытый мир"] },
  { title: "Counter-Strike 2 — Prime Status Upgrade", category: "steam-klyuchi", type: "KEY", delivery: "AUTO_STOCK", price: 1149, platform: "STEAM", region: "GLOBAL", seller: 0, weight: 8,
    blurb: "Статус Prime для CS2: приоритетный матчмейкинг, награды и кейсы.", tags: ["шутер", "cs2", "valve"] },
  { title: "The Witcher 3: Wild Hunt — Game of the Year", category: "steam-klyuchi", type: "KEY", delivery: "AUTO_STOCK", price: 599, oldPrice: 1299, platform: "STEAM", region: "GLOBAL", seller: 2, weight: 7,
    blurb: "Полное издание игры года со всеми дополнениями.", tags: ["rpg", "ведьмак"] },
  { title: "Grand Theft Auto V Premium Edition", category: "steam-klyuchi", type: "KEY", delivery: "AUTO_STOCK", price: 799, oldPrice: 1499, platform: "STEAM", region: "CIS", seller: 0, weight: 9,
    blurb: "Los Santos ждёт: сюжетная кампания и GTA Online в одной коробке.", tags: ["rockstar", "открытый мир"] },
  { title: "Palworld", category: "steam-klyuchi", type: "KEY", delivery: "AUTO_STOCK", price: 1399, platform: "STEAM", region: "CIS", seller: 2, weight: 5,
    blurb: "Выживание, крафт и ловля существ-палов в огромном открытом мире.", tags: ["выживание", "кооператив"] },
  { title: "Helldivers 2", category: "steam-klyuchi", type: "KEY", delivery: "AUTO_STOCK", price: 2199, platform: "STEAM", region: "CIS", seller: 1, weight: 5,
    blurb: "Кооперативный шутер от третьего лица: несите демократию на дальние планеты.", tags: ["шутер", "кооператив"] },
  { title: "Black Myth: Wukong", category: "steam-klyuchi", type: "KEY", delivery: "AUTO_STOCK", price: 3299, oldPrice: 3799, platform: "STEAM", region: "CIS", seller: 1, weight: 4,
    blurb: "Экшен по мотивам «Путешествия на Запад» с потрясающей графикой.", tags: ["экшен", "souls-like"] },
  { title: "Stardew Valley", category: "steam-klyuchi", type: "KEY", delivery: "AUTO_STOCK", price: 349, platform: "STEAM", region: "GLOBAL", seller: 2, weight: 6,
    blurb: "Уютная фермерская симуляция: выращивайте урожай, дружите с жителями долины.", tags: ["инди", "симулятор", "кооператив"] },

  // ───────── Xbox ─────────
  { title: "Forza Horizon 5", category: "xbox", type: "KEY", delivery: "AUTO_STOCK", price: 2299, oldPrice: 3199, platform: "XBOX", region: "EU", seller: 0, weight: 5, featured: true,
    blurb: "Гоночный фестиваль в Мексике. Активация на Xbox и Windows (Xbox Play Anywhere).", tags: ["гонки", "play anywhere"] },
  { title: "Starfield", category: "xbox", type: "KEY", delivery: "AUTO_STOCK", price: 3499, oldPrice: 4999, platform: "XBOX", region: "EU", seller: 0, weight: 3,
    blurb: "Космическая RPG от Bethesda. Исследуйте 1000 планет.", tags: ["rpg", "космос", "bethesda"] },
  { title: "Microsoft Flight Simulator 2024", category: "xbox", type: "KEY", delivery: "AUTO_STOCK", price: 3999, platform: "XBOX", region: "EU", seller: 1, weight: 2,
    blurb: "Самый реалистичный авиасимулятор: тысячи самолётов и аэропортов.", tags: ["симулятор", "авиация"] },

  // ───────── PlayStation ─────────
  { title: "God of War Ragnarök (PS5)", category: "playstation", type: "ACCOUNT", delivery: "AUTO_STOCK", price: 2599, oldPrice: 3599, platform: "PLAYSTATION", region: "TR", seller: 2, weight: 5, featured: true,
    blurb: "Кратос и Атрей встречают Рагнарёк. Аккаунт PSN с игрой (турецкий регион), доступ через «Игра в поколении».", tags: ["экшен", "ps5", "эксклюзив"] },
  { title: "Marvel's Spider-Man 2 (PS5)", category: "playstation", type: "ACCOUNT", delivery: "AUTO_STOCK", price: 2999, platform: "PLAYSTATION", region: "TR", seller: 2, weight: 4,
    blurb: "Питер и Майлз против Венома. Аккаунт PSN с игрой для PS5.", tags: ["экшен", "ps5", "marvel"] },
  { title: "EA SPORTS FC 25 (PS5)", category: "playstation", type: "ACCOUNT", delivery: "AUTO_STOCK", price: 2199, oldPrice: 3299, platform: "PLAYSTATION", region: "TR", seller: 2, weight: 4,
    blurb: "Новый сезон футбола. Аккаунт PSN с игрой для PS5.", tags: ["футбол", "спорт", "ps5"] },

  // ───────── Nintendo ─────────
  { title: "The Legend of Zelda: Tears of the Kingdom", category: "nintendo", type: "KEY", delivery: "AUTO_STOCK", price: 4499, platform: "NINTENDO", region: "EU", seller: 1, weight: 2,
    blurb: "Новое приключение Линка в небесах Хайрула. Код для eShop (Европа).", tags: ["приключение", "switch"] },
  { title: "Mario Kart 8 Deluxe", category: "nintendo", type: "KEY", delivery: "AUTO_STOCK", price: 3999, oldPrice: 4799, platform: "NINTENDO", region: "EU", seller: 1, weight: 2,
    blurb: "Лучшие гонки на Nintendo Switch. Цифровой код eShop (Европа).", tags: ["гонки", "switch", "мультиплеер"] },

  // ───────── Подписки ─────────
  { title: "ChatGPT Plus", category: "ai-servisy", type: "SUBSCRIPTION", delivery: "AUTO_STOCK", price: 1990, platform: "OTHER", region: "GLOBAL", seller: 2, weight: 9, featured: true,
    blurb: "Подписка ChatGPT Plus: доступ к новейшим моделям, генерации изображений и расширенным лимитам. Выдаётся доступ к личному аккаунту.",
    tags: ["ии", "openai", "chatgpt"], variants: [v("1 месяц", 1990, 2390, { months: 1 }), v("3 месяца", 5490, 6990, { months: 3 }), v("12 месяцев", 19900, 26900, { months: 12 })] },
  { title: "Claude Pro", category: "ai-servisy", type: "SUBSCRIPTION", delivery: "MANUAL", price: 1990, platform: "OTHER", region: "GLOBAL", seller: 0, weight: 3,
    blurb: "Подписка Claude Pro от Anthropic. Продавец оформит подписку на вашу почту в течение 30 минут.",
    tags: ["ии", "anthropic", "claude"], variants: [v("1 месяц", 1990, undefined, { months: 1 }), v("3 месяца", 5590, 5970, { months: 3 })] },
  { title: "Spotify Premium", category: "muzyka-i-video", type: "SUBSCRIPTION", delivery: "AUTO_STOCK", price: 349, platform: "OTHER", region: "GLOBAL", seller: 2, weight: 8, featured: true,
    blurb: "Музыка без рекламы и офлайн-режим. Индивидуальная подписка на ваш аккаунт или новый аккаунт с доступом.",
    tags: ["музыка", "spotify"], variants: [v("1 месяц", 349, 429, { months: 1 }), v("3 месяца", 949, 1287, { months: 3 }), v("12 месяцев", 3490, 5148, { months: 12 })] },
  { title: "Netflix Premium 4K", category: "muzyka-i-video", type: "SUBSCRIPTION", delivery: "AUTO_STOCK", price: 590, platform: "OTHER", region: "GLOBAL", seller: 2, weight: 6,
    blurb: "Netflix в качестве Ultra HD на 4 экранах. Аккаунт с профилем на ваш выбор.",
    tags: ["кино", "сериалы", "netflix"], variants: [v("1 месяц", 590, undefined, { months: 1 }), v("3 месяца", 1590, 1770, { months: 3 })] },
  { title: "YouTube Premium", category: "muzyka-i-video", type: "SUBSCRIPTION", delivery: "MANUAL", price: 299, platform: "OTHER", region: "GLOBAL", seller: 0, weight: 5,
    blurb: "YouTube без рекламы, фоновое воспроизведение и YouTube Music. Подключение на ваш аккаунт Google.",
    tags: ["видео", "youtube"], variants: [v("1 месяц", 299, 399, { months: 1 }), v("6 месяцев", 1590, 2394, { months: 6 }), v("12 месяцев", 2790, 4788, { months: 12 })] },
  { title: "Discord Nitro", category: "muzyka-i-video", type: "SUBSCRIPTION", delivery: "AUTO_STOCK", price: 899, platform: "OTHER", region: "GLOBAL", seller: 1, weight: 6,
    blurb: "Discord Nitro: HD-стримы, большие файлы, эмодзи везде и бусты серверу. Выдаётся ссылка-подарок.",
    tags: ["discord", "nitro"], variants: [v("1 месяц", 899, 1099, { months: 1 }), v("12 месяцев", 7990, 10999, { months: 12 })] },
  { title: "Xbox Game Pass Ultimate", category: "igrovye-podpiski", type: "SUBSCRIPTION", delivery: "AUTO_STOCK", price: 1190, platform: "XBOX", region: "GLOBAL", seller: 0, weight: 7, featured: true,
    blurb: "Сотни игр для Xbox, PC и облака, онлайн-мультиплеер и EA Play. Код активации на аккаунт Microsoft.",
    tags: ["game pass", "xbox", "подписка"], variants: [v("1 месяц", 1190, 1490, { months: 1 }), v("3 месяца", 3290, 4470, { months: 3 }), v("12 месяцев", 11990, 17880, { months: 12 })] },
  { title: "PlayStation Plus Extra (Турция)", category: "igrovye-podpiski", type: "SUBSCRIPTION", delivery: "AUTO_STOCK", price: 1490, platform: "PLAYSTATION", region: "TR", seller: 2, weight: 6,
    blurb: "PS Plus Extra: каталог из сотен игр и онлайн-мультиплеер. Код активации для турецкого аккаунта PSN.",
    tags: ["ps plus", "playstation", "подписка"], variants: [v("1 месяц", 1490, 1790, { months: 1 }), v("3 месяца", 3990, 5370, { months: 3 }), v("12 месяцев", 13990, 21480, { months: 12 })] },
  { title: "EA Play", category: "igrovye-podpiski", type: "SUBSCRIPTION", delivery: "AUTO_STOCK", price: 399, platform: "EA", region: "GLOBAL", seller: 1, weight: 2,
    blurb: "Библиотека игр Electronic Arts на PC и Xbox.", tags: ["ea", "подписка"],
    variants: [v("1 месяц", 399, undefined, { months: 1 }), v("12 месяцев", 2990, 4788, { months: 12 })] },

  // ───────── Пополнение Steam ─────────
  { title: "Пополнение Steam (Россия, RUB)", category: "popolnenie-steam", type: "TOPUP", delivery: "AUTO_PROVIDER", price: 500, platform: "STEAM", region: "RU", seller: 1, weight: 14, featured: true,
    blurb: "Пополнение кошелька Steam по логину. Укажите логин (не email и не никнейм) — деньги придут за 1–5 минут.",
    tags: ["steam", "пополнение", "кошелёк"],
    variants: [v("500 ₽", 520, undefined, { amountRub: 500 }, "STEAM_RU_500"), v("1000 ₽", 1040, undefined, { amountRub: 1000 }, "STEAM_RU_1000"),
      v("2000 ₽", 2080, undefined, { amountRub: 2000 }, "STEAM_RU_2000"), v("5000 ₽", 5200, undefined, { amountRub: 5000 }, "STEAM_RU_5000")] },
  { title: "Пополнение Steam (Казахстан, KZT)", category: "popolnenie-steam", type: "TOPUP", delivery: "AUTO_PROVIDER", price: 460, platform: "STEAM", region: "KZ", seller: 1, weight: 4,
    blurb: "Пополнение Steam-аккаунта с регионом Казахстан (тенге) — игры и донат дешевле.",
    tags: ["steam", "пополнение", "казахстан"],
    variants: [v("2 500 ₸", 460, undefined, { amountKzt: 2500 }, "STEAM_KZ_2500"), v("5 000 ₸", 910, undefined, { amountKzt: 5000 }, "STEAM_KZ_5000"),
      v("10 000 ₸", 1790, undefined, { amountKzt: 10000 }, "STEAM_KZ_10000")] },

  // ───────── Подарочные карты ─────────
  { title: "Steam Gift Card (Россия)", category: "podarochnye-karty", type: "GIFT_CARD", delivery: "AUTO_STOCK", price: 510, platform: "STEAM", region: "RU", seller: 0, weight: 8,
    blurb: "Код пополнения Steam-кошелька для аккаунтов с регионом Россия. Активируйте в разделе «Активировать продукт Steam».",
    tags: ["steam", "gift card"], variants: [v("500 ₽", 510, undefined, { amountRub: 500 }), v("1000 ₽", 1020, undefined, { amountRub: 1000 }), v("2500 ₽", 2550, undefined, { amountRub: 2500 })] },
  { title: "PlayStation Store Gift Card (Турция)", category: "podarochnye-karty", type: "GIFT_CARD", delivery: "AUTO_STOCK", price: 690, platform: "PLAYSTATION", region: "TR", seller: 2, weight: 6,
    blurb: "Карта пополнения PlayStation Store для турецкого аккаунта PSN.", tags: ["psn", "gift card", "турция"],
    variants: [v("250 TL", 690, undefined, { amountTry: 250 }), v("500 TL", 1340, undefined, { amountTry: 500 }), v("1000 TL", 2590, undefined, { amountTry: 1000 })] },
  { title: "Xbox Gift Card (США)", category: "podarochnye-karty", type: "GIFT_CARD", delivery: "AUTO_STOCK", price: 990, platform: "XBOX", region: "US", seller: 0, weight: 3,
    blurb: "Подарочная карта Xbox для аккаунта США.", tags: ["xbox", "gift card"],
    variants: [v("$10", 990, undefined, { amountUsd: 10 }), v("$25", 2390, undefined, { amountUsd: 25 }), v("$50", 4690, undefined, { amountUsd: 50 })] },
  { title: "Apple App Store & iTunes (Турция)", category: "podarochnye-karty", type: "GIFT_CARD", delivery: "AUTO_STOCK", price: 640, platform: "MOBILE", region: "TR", seller: 2, weight: 3,
    blurb: "Пополнение Apple ID с регионом Турция: приложения, подписки, iCloud.", tags: ["apple", "itunes"],
    variants: [v("250 TL", 640), v("500 TL", 1250), v("1000 TL", 2450)] },
  { title: "Google Play Gift Card (Россия)", category: "podarochnye-karty", type: "GIFT_CARD", delivery: "AUTO_STOCK", price: 520, platform: "MOBILE", region: "RU", seller: 0, weight: 3,
    blurb: "Код пополнения Google Play для аккаунтов с регионом Россия.", tags: ["google play", "android"],
    variants: [v("500 ₽", 520), v("1000 ₽", 1040), v("2000 ₽", 2070)] },
  { title: "Roblox Gift Card", category: "podarochnye-karty", type: "GIFT_CARD", delivery: "AUTO_STOCK", price: 450, platform: "PC", region: "GLOBAL", seller: 1, weight: 4,
    blurb: "Подарочная карта Roblox: Robux и Premium.", tags: ["roblox", "robux"],
    variants: [v("400 Robux", 450), v("800 Robux", 890), v("1700 Robux", 1790)] },

  // ───────── Игровая валюта ─────────
  { title: "Genshin Impact — Кристаллы Сотворения", category: "igrovaya-valyuta", type: "CURRENCY", delivery: "MANUAL", price: 85, platform: "PC", region: "GLOBAL", seller: 1, weight: 6, featured: true,
    blurb: "Пополнение по UID — безопасно, без передачи пароля. Выполняется продавцом вручную в течение 15 минут.",
    tags: ["genshin", "hoyoverse", "донат"],
    variants: [v("60 кристаллов", 85, undefined, { amount: 60 }), v("330 кристаллов", 430, undefined, { amount: 330 }), v("1090 кристаллов", 1390, undefined, { amount: 1090 }), v("2240 кристаллов", 2790, undefined, { amount: 2240 }), v("6480 кристаллов", 7990, undefined, { amount: 6480 })] },
  { title: "Valorant Points", category: "igrovaya-valyuta", type: "CURRENCY", delivery: "AUTO_STOCK", price: 460, platform: "PC", region: "EU", seller: 0, weight: 5,
    blurb: "Код пополнения Valorant Points для аккаунтов EU.", tags: ["valorant", "riot"],
    variants: [v("475 VP", 460), v("1000 VP", 920), v("2050 VP", 1790), v("3650 VP", 3190)] },
  { title: "Fortnite V-Bucks (карта пополнения)", category: "igrovaya-valyuta", type: "CURRENCY", delivery: "AUTO_STOCK", price: 880, platform: "EPIC", region: "EU", seller: 2, weight: 4,
    blurb: "Карта пополнения V-Bucks для Epic Games Store.", tags: ["fortnite", "v-bucks", "epic"],
    variants: [v("1000 V-Bucks", 880), v("2800 V-Bucks", 2290), v("5000 V-Bucks", 3890)] },

  // ───────── Программы ─────────
  { title: "Windows 11 Pro — ключ активации", category: "programmy", type: "KEY", delivery: "AUTO_STOCK", price: 599, oldPrice: 1990, platform: "PC", region: "GLOBAL", seller: 0, weight: 6,
    blurb: "Бессрочная лицензия Windows 11 Pro (OEM). Подходит для чистой установки и обновления.", tags: ["windows", "microsoft"] },
  { title: "Microsoft Office 2021 Professional Plus", category: "programmy", type: "KEY", delivery: "AUTO_STOCK", price: 899, oldPrice: 2490, platform: "PC", region: "GLOBAL", seller: 0, weight: 5,
    blurb: "Word, Excel, PowerPoint, Outlook и другие приложения. Привязка к аккаунту Microsoft.", tags: ["office", "microsoft"] },
  { title: "Kaspersky Standard", category: "programmy", type: "KEY", delivery: "AUTO_STOCK", price: 790, platform: "PC", region: "RU", seller: 2, weight: 3,
    blurb: "Защита от вирусов и мошенников. Лицензия на 1 год.", tags: ["антивирус", "лаборатория касперского"],
    variants: [v("1 устройство, 1 год", 790), v("3 устройства, 1 год", 1190), v("5 устройств, 1 год", 1590)] },
  { title: "NordVPN — подписка", category: "programmy", type: "SUBSCRIPTION", delivery: "AUTO_STOCK", price: 690, platform: "PC", region: "GLOBAL", seller: 1, weight: 3,
    blurb: "Быстрый и безопасный VPN. Аккаунт с активной подпиской.", tags: ["vpn", "nordvpn"],
    variants: [v("1 месяц", 690), v("6 месяцев", 2990), v("12 месяцев", 4990)] },

  // ───────── На модерации / черновики / отклонённые / архив ─────────
  { title: "Diablo IV (Battle.net)", category: "programmy", type: "KEY", delivery: "AUTO_STOCK", price: 2790, platform: "BATTLENET", region: "EU", seller: 2, status: "PENDING_REVIEW", weight: 0,
    blurb: "Ключ Diablo IV для Battle.net (EU). Ожидает проверки модератором." },
  { title: "Сборник аккаунтов Fortnite", category: "igrovaya-valyuta", type: "ACCOUNT", delivery: "AUTO_STOCK", price: 150, platform: "EPIC", region: "GLOBAL", seller: 1, status: "PENDING_REVIEW", weight: 0,
    blurb: "Аккаунты Fortnite с редкими скинами. Ожидает проверки." },
  { title: "Накрутка подписчиков Telegram", category: "programmy", type: "SERVICE", delivery: "MANUAL", price: 100, platform: "OTHER", region: "GLOBAL", seller: 1, status: "REJECTED", weight: 0,
    moderationNote: "Отклонено: услуги накрутки запрещены правилами площадки.", blurb: "Быстрая накрутка подписчиков." },
  { title: "Resident Evil 4 Remake", category: "steam-klyuchi", type: "KEY", delivery: "AUTO_STOCK", price: 1999, platform: "STEAM", region: "CIS", seller: 0, status: "DRAFT", weight: 0,
    blurb: "Черновик: ключи ещё не загружены." },
  { title: "Dying Light 2 Stay Human", category: "steam-klyuchi", type: "KEY", delivery: "AUTO_STOCK", price: 899, platform: "STEAM", region: "CIS", seller: 2, status: "ARCHIVED", weight: 0,
    blurb: "Снято с продажи по просьбе продавца.", extraStock: 0 },
];

export const REVIEW_TEXTS = {
  positive: [
    "Ключ пришёл мгновенно, всё активировалось без проблем. Рекомендую!",
    "Быстро и удобно, продавец молодец. Куплю ещё.",
    "Всё работает, отличная цена. Спасибо!",
    "Выдача автоматическая, заняла меньше минуты. 10/10",
    "Пополнение Steam пришло за пару минут, без лишних вопросов.",
    "Подписка активна, всё как в описании. Беру не первый раз.",
    "Дешевле, чем в других местах, и всё честно. Рекомендую магазин.",
    "Код рабочий, активировал сразу. Очень доволен.",
  ],
  neutral: [
    "В целом нормально, но пришлось немного подождать выдачи.",
    "Всё хорошо, инструкция могла бы быть подробнее.",
  ],
  negative: [
    "Ключ не подошёл по региону, пришлось обращаться в поддержку.",
    "Долго ждал, но в итоге проблему решили.",
  ],
  replies: [
    "Спасибо за отзыв! Рады, что всё прошло хорошо.",
    "Благодарим за покупку, ждём вас снова!",
    "Спасибо! Если возникнут вопросы — пишите в чат заказа.",
  ],
};
