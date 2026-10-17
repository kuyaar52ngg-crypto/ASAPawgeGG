"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { trackClient } from "./track-client";

/** Sends a first-party `page_view` on the first render and on every client-side navigation (admin pages are not tracked). */
export function PageViewTracker() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    const referrer = previous.current ? window.location.origin + previous.current : document.referrer || undefined;
    previous.current = pathname;
    if (pathname.startsWith("/admin")) return;
    trackClient("page_view", undefined, { path: pathname, referrer });
  }, [pathname]);

  return null;
}
