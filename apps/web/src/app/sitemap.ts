import type { MetadataRoute } from "next";
import { prisma } from "@asap/db";
import { INFO_SLUGS } from "./(shop)/info/content";

export const dynamic = "force-dynamic";

const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000";

/** Storefront sitemap: static pages, categories, ACTIVE products and sellers (all from Postgres). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories, sellers] = await Promise.all([
    prisma.product.findMany({ where: { status: "ACTIVE" }, select: { slug: true, updatedAt: true } }),
    prisma.category.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
    prisma.sellerProfile.findMany({ where: { status: "VERIFIED" }, select: { slug: true, updatedAt: true } }),
  ]);
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/catalog`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/steam`, changeFrequency: "weekly", priority: 0.9 },
    ...categories.map((c) => ({ url: `${base}/catalog/${c.slug}`, lastModified: c.updatedAt, changeFrequency: "daily" as const, priority: 0.8 })),
    ...products.map((p) => ({ url: `${base}/product/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...sellers.map((s) => ({ url: `${base}/seller-store/${s.slug}`, lastModified: s.updatedAt, changeFrequency: "weekly" as const, priority: 0.5 })),
    ...INFO_SLUGS.map((s) => ({ url: `${base}/info/${s}`, changeFrequency: "monthly" as const, priority: 0.3 })),
  ];
}
