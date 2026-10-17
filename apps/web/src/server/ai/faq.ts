import { FAQ_GROUPS } from "@/app/(shop)/info/content";

/** Keyword search over the site FAQ (the single knowledge base of the support assistant). Pure. */
const tokens = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2);
const stem = (w: string) => (w.length > 5 ? w.slice(0, w.length - 2) : w);

export function searchFaq(query: string, limit = 3): { q: string; a: string }[] {
  const qs = tokens(query).map(stem);
  if (!qs.length) return [];
  const scored = FAQ_GROUPS.flatMap((g) => g.items).map((item) => {
    const hay = `${item.q} ${item.a}`.toLowerCase();
    const head = item.q.toLowerCase();
    const score = qs.reduce((s, w) => s + (head.includes(w) ? 3 : hay.includes(w) ? 1 : 0), 0);
    return { item, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.item);
}
