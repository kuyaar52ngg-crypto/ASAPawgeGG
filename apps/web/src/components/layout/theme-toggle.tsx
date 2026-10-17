"use client";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/providers/theme-provider";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}>
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
