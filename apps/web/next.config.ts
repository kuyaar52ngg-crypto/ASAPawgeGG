import path from "node:path";
import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";

// Monorepo: load the ROOT .env (Next only reads apps/web/.env* by default).
const monorepoRoot = path.resolve(process.cwd(), process.cwd().endsWith(path.join("apps", "web")) ? "../.." : ".");
loadEnvConfig(monorepoRoot); // no-op when the root .env is absent (Vercel / CI use real env vars)

const onVercel = Boolean(process.env.VERCEL);

// Vercel: when no public URL is configured, use the deployment's own domain (previews: unique URL, production: project domain).
// NEXT_PUBLIC_APP_URL is inlined at build time, which makes metadata/sitemap/JSON-LD (and lib/env.ts) pick it up.
const vercelHost = process.env.VERCEL_ENV === "preview" ? process.env.VERCEL_URL : (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL);
const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || (onVercel && vercelHost ? `https://${vercelHost}` : undefined);

const nextConfig: NextConfig = {
  // Vercel produces its own function bundles; the standalone server is for Docker / self-hosting only
  ...(onVercel ? {} : { output: "standalone" as const }),
  ...(publicAppUrl ? { env: { NEXT_PUBLIC_APP_URL: publicAppUrl } } : {}),
  outputFileTracingRoot: monorepoRoot,
  // Workspace packages export raw TypeScript
  transpilePackages: ["@asap/db", "@asap/shared"],
  serverExternalPackages: ["@node-rs/argon2", "ioredis", "pg", "@prisma/client", "@prisma/adapter-pg"],
  poweredByHeader: false,
  images: {
    // Generated SVG artwork (/api/art/*) is served through next/image as-is
    dangerouslyAllowSVG: true,
    contentDispositionType: "inline",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "fastly.picsum.photos" },
      { protocol: "https", hostname: "placehold.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "cdn.cloudflare.steamstatic.com" },
      { protocol: "https", hostname: "shared.fastly.steamstatic.com" },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "date-fns"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // honoured by browsers on https only; harmless on plain-http localhost
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
