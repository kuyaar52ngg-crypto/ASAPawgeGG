import "server-only";
import { prisma } from "@asap/db";
import { PLATFORMS, type ProductTypeName } from "@asap/shared";
import { cached } from "@/lib/redis";
import { getCategoryTree } from "@/server/categories";

/** Escape LIKE wildcards so user input is matched literally. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function normalizeQuery(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 80);
}

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = "йцукенгшщзхъфывапролджэячсмитьбюё";

/** Convert text typed in the wrong keyboard layout (gta -> пеф / цптщ -> gta). Returns null when nothing changes. */
export function switchLayout(s: string): string | null {
  const lower = s.toLowerCase();
  const hasLatin = /[a-z]/.test(lower);
  const hasCyr = /[а-яё]/.test(lower);
  if (hasLatin === hasCyr) return null;
  const from = hasLatin ? EN : RU;
  const to = hasLatin ? RU : EN;
  const out = [...lower].map((ch) => {
    const i = from.indexOf(ch);
    return i >= 0 ? to[i]! : ch;
  }).join("");
  return out === lower ? null : out;
}

/**
 * Ranked search over ACTIVE products: exact title > prefix > substring > pg_trgm similarity (typos) > tags.
 * Uses the GIN trigram index on Product.title.
 */
async function rankedIds(term: string, limit: number): Promise<string[]> {
  const contains = `%${likeEscape(term)}%`;
  const prefix = `${likeEscape(term)}%`;
  const fuzzy = term.length >= 3;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id
    FROM "Product" p
    WHERE p.status = 'ACTIVE' AND (
      p.title ILIKE ${contains} ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM unnest(p.tags) t WHERE t ILIKE ${contains} ESCAPE '\\')
      OR (${fuzzy} AND (similarity(p.title, ${term}) > 0.25 OR word_similarity(${term}, p.title) > 0.5))
    )
    ORDER BY
      (lower(p.title) = lower(${term})) DESC,
      (p.title ILIKE ${prefix} ESCAPE '\\') DESC,
      (p.title ILIKE ${contains} ESCAPE '\\') DESC,
      GREATEST(similarity(p.title, ${term}), word_similarity(${term}, p.title)) DESC,
      p."salesCount" DESC
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

/** Common Russian spellings / abbreviations -> catalog spelling (token level). */
const ALIASES: Record<string, string> = {
  гта: "grand theft auto",
  gta: "grand theft auto",
  кс: "counter-strike",
  кс2: "counter-strike 2",
  cs: "counter-strike",
  cs2: "counter-strike 2",
  ксго: "counter-strike",
  рдр: "red dead redemption",
  rdr2: "red dead redemption 2",
  rdr: "red dead redemption",
  bg3: "baldur's gate 3",
  бг3: "baldur's gate 3",
  ведьмак: "witcher",
  киберпанк: "cyberpunk",
  элден: "elden",
  стим: "steam",
  хбокс: "xbox",
  иксбокс: "xbox",
  гейм: "game",
  геймпасс: "game pass",
  плейстейшен: "playstation",
  пс: "playstation",
  пс5: "playstation",
  ps: "playstation",
  ps5: "playstation",
  псн: "playstation",
  нинтендо: "nintendo",
  спотифай: "spotify",
  нетфликс: "netflix",
  дискорд: "discord",
  нитро: "nitro",
  ютуб: "youtube",
  чатгпт: "chatgpt",
  гпт: "gpt",
  клод: "claude",
  роблокс: "roblox",
  фортнайт: "fortnite",
  вбаксы: "v-bucks",
  валорант: "valorant",
  геншин: "genshin",
  нордвпн: "nordvpn",
  впн: "vpn",
  касперский: "kaspersky",
  виндовс: "windows",
  офис: "office",
  майкрософт: "microsoft",
  гугл: "google",
  эпл: "apple",
  ориджин: "ea",
  фифа: "fc",
  fifa: "fc",
};

/** Alternative spelling of the whole query via the alias dictionary, or null if no token was replaced. */
export function aliasQuery(term: string): string | null {
  let changed = false;
  const out = term
    .toLowerCase()
    .split(/\s+/)
    .map((t) => {
      const a = ALIASES[t];
      if (a) changed = true;
      return a ?? t;
    })
    .join(" ");
  return changed ? out : null;
}

/**
 * Product ids matching the query, best first: the literal query, then its alias spelling (gta -> grand theft auto,
 * спотифай -> spotify), then — only when nothing matched — the same text typed in the other keyboard layout.
 */
export async function searchProductIds(rawQuery: string, limit = 200): Promise<string[]> {
  const term = normalizeQuery(rawQuery);
  if (term.length < 1) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (ids: string[]) => {
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  };
  add(await rankedIds(term, limit));
  const alias = aliasQuery(term);
  if (alias) add(await rankedIds(alias, limit));
  if (out.length === 0) {
    const alt = switchLayout(term);
    if (alt) {
      add(await rankedIds(alt, limit));
      const altAlias = aliasQuery(alt);
      if (altAlias) add(await rankedIds(altAlias, limit));
    }
  }
  return out.slice(0, limit);
}

export interface SuggestProduct {
  slug: string;
  title: string;
  image: string | null;
  price: number;
  hasVariants: boolean;
  platform: string | null;
  type: ProductTypeName;
}
export interface SuggestCategory {
  slug: string;
  name: string;
}
export interface SuggestResult {
  q: string;
  products: SuggestProduct[];
  categories: SuggestCategory[];
  total: number;
}

/** Header live-suggest. Redis-cached for 60s per normalised query. */
export async function suggest(rawQuery: string): Promise<SuggestResult> {
  const q = normalizeQuery(rawQuery);
  if (q.length < 2) return { q, products: [], categories: [], total: 0 };
  return cached(`suggest:${q.toLowerCase()}`, 60, async () => {
    const ids = await searchProductIds(q, 40);
    const rows = ids.length
      ? await prisma.product.findMany({
          where: { id: { in: ids.slice(0, 6) }, status: "ACTIVE" },
          select: { id: true, slug: true, title: true, coverImage: true, price: true, platform: true, type: true, _count: { select: { variants: { where: { isActive: true } } } } },
        })
      : [];
    const pos = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));

    const needle = q.toLowerCase();
    const tree = await getCategoryTree();
    const flat = tree.flatMap((c) => [c, ...c.children]);
    const categories = flat.filter((c) => c.name.toLowerCase().includes(needle)).slice(0, 3).map((c) => ({ slug: c.slug, name: c.name }));

    return {
      q,
      total: ids.length,
      categories,
      products: rows.map((r) => ({
        slug: r.slug,
        title: r.title,
        image: r.coverImage,
        price: r.price,
        hasVariants: r._count.variants > 0,
        platform: r.platform ? (PLATFORMS.find((p) => p.value === r.platform)?.label ?? r.platform) : null,
        type: r.type as ProductTypeName,
      })),
    };
  });
}
