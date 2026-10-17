import { ProviderError } from "./types";

export type FetchLike = typeof fetch;

/** JSON request with timeout + readable errors. Never logs secrets. */
export async function requestJson(
  f: FetchLike,
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: unknown; timeoutMs?: number },
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(url, {
      method: init.method,
      headers: { accept: "application/json", ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new ProviderError(`Провайдер недоступен: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const msg = typeof json.message === "string" ? json.message : typeof json.error === "string" ? json.error : text.slice(0, 200);
    throw new ProviderError(`Провайдер вернул ${res.status}${msg ? `: ${msg}` : ""}`, res.status);
  }
  return json;
}

/** First defined string value among the given keys (case-sensitive), searching nested `data`/`result` objects too. */
export function pickString(obj: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const scope of [obj, obj.data, obj.result, obj.invoice, obj.transaction]) {
    if (!scope || typeof scope !== "object") continue;
    for (const k of keys) {
      const v = (scope as Record<string, unknown>)[k];
      if (typeof v === "string" && v) return v;
      if (typeof v === "number") return String(v);
    }
  }
  return undefined;
}

export function pickNumber(obj: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const scope of [obj, obj.data, obj.result, obj.invoice, obj.transaction, obj.paymentDetails]) {
    if (!scope || typeof scope !== "object") continue;
    for (const k of keys) {
      const v = (scope as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
    }
  }
  return undefined;
}
