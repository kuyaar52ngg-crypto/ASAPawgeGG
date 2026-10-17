import { AppWindow, Bot, Coins, Gamepad, Gamepad2, Gift, Joystick, LayoutGrid, Monitor, Music, Repeat, Trophy, Wallet, type LucideIcon } from "lucide-react";

/** Category.icon (kebab-case lucide name) -> component. Add new icons here when you add categories. */
const MAP: Record<string, LucideIcon> = {
  "gamepad-2": Gamepad2,
  gamepad: Gamepad,
  monitor: Monitor,
  joystick: Joystick,
  repeat: Repeat,
  trophy: Trophy,
  bot: Bot,
  music: Music,
  wallet: Wallet,
  gift: Gift,
  coins: Coins,
  "app-window": AppWindow,
};

export function CategoryIcon({ name, className }: { name?: string | null; className?: string }) {
  const Icon = (name && MAP[name]) || LayoutGrid;
  return <Icon className={className} />;
}
