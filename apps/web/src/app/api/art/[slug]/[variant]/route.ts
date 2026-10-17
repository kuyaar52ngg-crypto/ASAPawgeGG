/**
 * Deterministic generated artwork (SVG) for seeded products / avatars: `/api/art/<slug>/<variant>`
 * variant = cover (600x800) | avatar (200x200) | 1 | 2 | 3 (1280x720 gallery frames).
 * Keeps the demo fully self-contained (no dependency on third-party image hosts). Sellers may still use allow-listed https hosts.
 */
// force-dynamic (not force-static): the slug is attacker-controlled, so prerendering would let anyone grow the on-disk page cache without bound.
// The response is still cached by browsers/CDNs through its cache-control header.
export const dynamic = "force-dynamic";

const SIZES: Record<string, [number, number]> = { cover: [600, 800], avatar: [200, 200], "1": [1280, 720], "2": [1280, 720], "3": [1280, 720] };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

function titleOf(slug: string): string {
  return slug
    .replace(/-avatar$/, "")
    .split("-")
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(" ")) {
    if ((cur + " " + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; variant: string }> }) {
  const { slug, variant: rawVariant } = await ctx.params;
  const variant = rawVariant.replace(/\.svg$/, "");
  const size = SIZES[variant];
  if (!size || !/^[a-z0-9-]{1,120}$/i.test(slug)) return new Response("Not found", { status: 404 });
  const [w, h] = size;
  const seed = hash(slug);
  const v = hash(slug + variant);
  const h1 = seed % 360;
  const h2 = (h1 + 40 + (seed >> 9) % 80) % 360;
  const title = titleOf(slug);
  const isAvatar = variant === "avatar";
  const base = Math.min(w, h);

  const orbs = [0, 1, 2]
    .map((i) => {
      const x = ((v >> (i * 5)) % 100) / 100 * w;
      const y = ((v >> (i * 5 + 2)) % 100) / 100 * h;
      const r = base * (0.25 + (((v >> (i * 3)) % 40) / 100));
      const hue = i % 2 ? h2 : h1;
      return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(0)}" fill="hsl(${hue} 85% 55%)" opacity="0.28" filter="url(#b)"/>`;
    })
    .join("");

  let label = "";
  if (isAvatar) {
    const initials = title.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();
    label = `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-weight="800" font-size="80" fill="#fff">${esc(initials)}</text>`;
  } else {
    const portrait = h > w;
    const fs = portrait ? 54 : 64;
    const lines = wrap(title, portrait ? 12 : 22);
    const startY = h * (portrait ? 0.62 : 0.5) - ((lines.length - 1) * fs * 1.1) / 2;
    label =
      lines.map((l, i) => `<text x="${portrait ? 40 : w / 2}" y="${(startY + i * fs * 1.1).toFixed(0)}" ${portrait ? "" : 'text-anchor="middle"'} font-family="system-ui,sans-serif" font-weight="800" font-size="${fs}" fill="#fff">${esc(l)}</text>`).join("") +
      `<text x="${portrait ? 40 : w / 2}" y="${portrait ? h - 40 : h - 36}" ${portrait ? "" : 'text-anchor="middle"'} font-family="system-ui,sans-serif" font-weight="700" font-size="22" letter-spacing="3" fill="#fff" opacity="0.6">ASAPAWGE GG</text>`;
  }

  const grid = isAvatar ? "" : `<g stroke="#fff" stroke-opacity="0.05">${Array.from({ length: 12 }, (_, i) => `<path d="M${(i * w) / 12} 0V${h}M0 ${(i * h) / 12}H${w}"/>`).join("")}</g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1} 60% 14%)"/><stop offset="1" stop-color="hsl(${h2} 70% 9%)"/></linearGradient>
<filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${(base / 8).toFixed(0)}"/></filter></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>${orbs}${grid}
<rect x="${w * 0.04}" y="${h * 0.04}" width="${w * 0.92}" height="${h * 0.92}" rx="${base * 0.04}" fill="none" stroke="#fff" stroke-opacity="0.08"/>${label}
</svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=31536000, immutable", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "x-content-type-options": "nosniff" } });
}
