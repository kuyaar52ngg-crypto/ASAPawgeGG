"use client";
import * as React from "react";

export type Theme = "dark" | "light";
const STORAGE_KEY = "asap-theme";

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}
const Ctx = React.createContext<ThemeCtx>({ theme: "dark", setTheme: () => {}, toggle: () => {} });

/** Inline script (rendered in <head>) — applies the saved theme BEFORE first paint. Dark is the default. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}')||'dark';var d=document.documentElement;d.classList.remove('dark','light');d.classList.add(t==='light'?'light':'dark');d.classList.add('js');}catch(e){document.documentElement.classList.add('dark','js');}})();`;

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}
const getSnapshot = (): Theme => (document.documentElement.classList.contains("light") ? "light" : "dark");
const getServerSnapshot = (): Theme => "dark";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // The <html> class (set pre-paint by themeInitScript) is the single source of truth.
  const theme = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = React.useCallback((t: Theme) => {
    const el = document.documentElement;
    el.classList.remove("dark", "light");
    el.classList.add(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* private mode */
    }
  }, []);

  const value = React.useMemo(() => ({ theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") }), [theme, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => React.useContext(Ctx);
