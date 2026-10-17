/** Splits assistant text into plain / link parts: internal paths (/product/…, /account/…) and http(s) URLs become links. */

export type Part = { kind: "text"; text: string } | { kind: "link"; text: string; href: string; external: boolean };

const RE = /(https?:\/\/[^\s<>()]+|\/(?:product|account|catalog|seller-store|info|checkout|steam|search|cart|seller)(?:\/[^\s<>()]*)?)/g;

export function linkify(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(RE)) {
    const start = m.index ?? 0;
    // an internal path glued to a word (e.g. "a/product/x") is not a link
    if (m[0].startsWith("/") && start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1]!)) continue;
    let raw = m[0];
    const trimmed = raw.replace(/[.,;:!?»”)]+$/u, "");
    const tail = raw.slice(trimmed.length);
    raw = trimmed;
    if (start > last) parts.push({ kind: "text", text: text.slice(last, start) });
    parts.push({ kind: "link", text: raw, href: raw, external: raw.startsWith("http") });
    last = start + raw.length;
    if (tail) {
      parts.push({ kind: "text", text: tail });
      last += tail.length;
    }
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}
