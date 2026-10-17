# Figma: ASAPawge GG — Design

Файл: https://www.figma.com/design/GR7h7BxRoBIlN23V1hr30k (fileKey `GR7h7BxRoBIlN23V1hr30k`).
Строится через Figma MCP `use_figma`; хелперы для скриптов — [`prelude.js`](./prelude.js) (вставлять в начало каждого вызова).

## Ограничения тарифа Starter
- Не более 3 страниц на файл → `Design System` (0:1), `Desktop 1440` (1:2), `Mobile 390` (1:3).
- 1 режим на коллекцию переменных → тёмная и светлая темы — две коллекции с одинаковыми именами:
  `Color` (Dark, по умолчанию, `VariableCollectionId:3:3`) и `Color Light` (`VariableCollectionId:3:4`).
- Лимит вызовов Figma MCP — работа продолжается после его сброса.

## Готово (страница Design System)
| Секция | Node |
|---|---|
| Cover | 4:2 |
| 01 Color (Dark/Light) | 4:22 |
| 02 Typography | 5:2 |
| 03 Effects | 5:132 |
| 04 Radius & Spacing | 5:155 |
| 05 Icons (46 × `Icon/<name>`) | 6:2 |
| 06 Button (`Button` 8:114, `IconButton` 8:165) | 8:2 |
| 07 Badge / Chip / DiscountTag (9:107, 9:115, 9:119) | 9:84 |
| 08 Rating / Price / Avatar (9:172, 9:197, 9:219) | 9:121 |

Переменные: `Radius` (`VariableCollectionId:3:93`, radius/xs…full), `Spacing` (`VariableCollectionId:3:101`, space/2…64),
цвета `bg/*`, `text/*`, `border/*`, `brand/*`, `status/*`, `glow/*`, `overlay/*`, `chart/*`.
Стили текста: Display, H1–H3, Heading/*, Body/L|M|S, Label(/L|/S), Caption(/Semibold), Micro, Overline, Price/S|M|L, Logo.
Эффекты: Glow Violet(/Button,/Tab), Glow Cyan, Glass, Shadow/Popover. Заливка: Brand/Gradient.

## Осталось
1. Удалить мусор на 0:1: фрейм `Section / Form controls` и одиночный COMPONENT `State=default` (недостроенная секция).
2. 09 Form controls: Input (default/focus/error), SearchBar, Select (+Item/Menu), Checkbox, Switch, Tabs.
3. ProductCard, CategoryTile, SectionHeader, Header/Desktop, Header/Mobile, Footer, Sidebar item, KPI Card, TableRow, ChartCard.
4. Экраны Desktop 1440 и Mobile 390: Главная, Каталог, Товар, Steam, Корзина, Заказ в ЛК, Кабинет продавца, Админ-дашборд
   (+ Вход и Оформление на десктопе) — по эталонам `docs/screenshots/*.png`.
