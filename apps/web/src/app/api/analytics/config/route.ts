import { NextResponse } from "next/server";
import { getSetting } from "@asap/db";
import { SETTING_KEYS } from "@asap/shared";
import { cached } from "@/lib/redis";

export const dynamic = "force-dynamic";

/**
 * Public client config for analytics: the Yandex Metrika counter id from Setting("analytics.ymId") (admin → Настройки).
 * Fetched by <Analytics/> only when NEXT_PUBLIC_YM_ID is not baked into the build, so pages can stay statically rendered.
 */
export async function GET() {
  const raw = await cached("analytics:config", 60, async () => {
    const v = await getSetting<string | number>(SETTING_KEYS.ymId, "").catch(() => "");
    return String(v ?? "").trim();
  }).catch(() => "");
  const ymId = /^\d{4,12}$/.test(raw) ? Number(raw) : null;
  return NextResponse.json({ ymId }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
}
