"use client";
import * as React from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type SteamLoginStatus = "idle" | "checking" | "valid" | "invalid" | "error";

const LOGIN_RE = /^[A-Za-z0-9_.-]{3,64}$/;

interface CheckResponse {
  ok: boolean;
  data?: { ok: boolean; displayName?: string; reason?: string; source: "mock" | "http" };
  error?: { message: string };
}

/**
 * Steam login input with live validation against POST /api/steam/check-login (debounced).
 * Reports the status upward so forms can block submit on "invalid".
 */
export function SteamLoginField({
  value,
  onChange,
  onStatus,
  error,
  id = "steam-login",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onStatus?: (s: SteamLoginStatus) => void;
  error?: string;
  id?: string;
  className?: string;
}) {
  const login = value.trim();
  // synchronous validation is derived during render; only supplier answers live in state
  const syntax: { s: SteamLoginStatus; m: string } | null = !login
    ? { s: "idle", m: "" }
    : !LOGIN_RE.test(login)
      ? { s: "invalid", m: login.includes("@") ? "Нужен логин Steam, а не email" : login.length < 3 ? "Минимум 3 символа" : "Логин Steam: латиница, цифры, _ . -" }
      : null;
  const [remote, setRemote] = React.useState<{ login: string; s: SteamLoginStatus; m: string; sandbox: boolean } | null>(null);
  const current = remote && remote.login === login ? remote : null;
  const status: SteamLoginStatus = syntax ? syntax.s : (current?.s ?? "checking");
  const message = syntax ? syntax.m : (current?.m ?? "");
  const sandbox = current?.sandbox ?? false;

  const cb = React.useRef(onStatus);
  React.useEffect(() => {
    cb.current = onStatus;
  });
  React.useEffect(() => {
    cb.current?.(status);
  }, [status]);

  React.useEffect(() => {
    if (!login || !LOGIN_RE.test(login)) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const done = (s: SteamLoginStatus, m: string, sb = false) => {
        if (!ctrl.signal.aborted) setRemote({ login, s, m, sandbox: sb });
      };
      try {
        const res = await fetch("/api/steam/check-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login }), signal: ctrl.signal });
        const json = (await res.json()) as CheckResponse;
        if (!json.ok || !json.data) return done("error", json.error?.message ?? "Не удалось проверить логин");
        const sb = json.data.source === "mock";
        if (json.data.ok) done("valid", json.data.displayName ? `Аккаунт найден: ${json.data.displayName}` : "Аккаунт найден", sb);
        else done("invalid", json.data.reason ?? "Аккаунт Steam не найден", sb);
      } catch {
        done("error", "Не удалось проверить логин. Можно продолжить — проверим при оплате.");
      }
    }, 550);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [login]);

  const shownError = error || (status === "invalid" ? message : undefined);
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        Логин Steam
      </label>
      <div className="relative">
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\s/g, ""))}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="text"
          maxLength={64}
          placeholder="например, gaben_1998"
          aria-invalid={Boolean(shownError)}
          aria-describedby={`${id}-hint`}
          className={cn(
            "h-12 w-full rounded-xl border border-input bg-foreground/[0.04] pr-11 pl-4 text-[15px] outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 aria-invalid:border-destructive",
            status === "valid" && !shownError && "border-success/60",
          )}
        />
        <span className="absolute top-1/2 right-3.5 -translate-y-1/2" aria-hidden>
          {status === "checking" && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
          {status === "valid" && !shownError && <CheckCircle2 className="size-5 text-success" />}
          {(status === "invalid" || shownError) && <XCircle className="size-5 text-destructive" />}
        </span>
      </div>
      <p id={`${id}-hint`} role={shownError ? "alert" : undefined} className={cn("mt-1.5 min-h-4 text-xs", shownError ? "text-destructive" : status === "valid" ? "text-success" : "text-muted-foreground")}>
        {shownError ??
          (status === "valid" ? `${message}${sandbox ? " (тестовая проверка)" : ""}` : status === "error" ? message : "Логин — это то, что вы вводите при входе в Steam (не email и не никнейм в профиле).")}
      </p>
    </div>
  );
}
