"use client";
import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { hit } from "@/lib/metrika";

/**
 * Yandex Metrika loader. The tag is only injected when a counter id is known:
 *   1. NEXT_PUBLIC_YM_ID (build/runtime env), else
 *   2. Setting("analytics.ymId") edited in /admin/settings (served by GET /api/analytics/config).
 * Webvisor, clickmap, link tracking and the ecommerce dataLayer are enabled. Route changes are sent as virtual hits.
 * Admin pages are never reported.
 */
export function YandexMetrika({ envId }: { envId: number | null }) {
  const [id, setId] = useState<number | null>(envId);
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    if (envId) return;
    let cancelled = false;
    fetch("/api/analytics/config", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ymId?: number | null } | null) => {
        if (!cancelled && j?.ymId && Number.isInteger(j.ymId)) setId(j.ymId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [envId]);

  useEffect(() => {
    if (id) window.__ymId = id;
  }, [id]);

  // SPA navigation → virtual page view (the initial hit is sent by `init`)
  useEffect(() => {
    if (!id || !pathname) return;
    if (first.current) {
      first.current = false;
      return;
    }
    if (pathname.startsWith("/admin")) return;
    hit(window.location.href, { title: document.title });
  }, [id, pathname]);

  if (!id || !Number.isInteger(id) || id <= 0) return null;
  if (pathname?.startsWith("/admin")) return null; // do not even initialise the counter inside the back office

  const snippet = `(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js?id=${id}","ym");window.dataLayer=window.dataLayer||[];ym(${id},"init",{ssr:true,webvisor:true,clickmap:true,ecommerce:"dataLayer",referrer:document.referrer,url:location.href,accurateTrackBounce:true,trackLinks:true});`;

  return (
    <>
      <Script id="yandex-metrika" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: snippet }} />
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`https://mc.yandex.ru/watch/${id}`} style={{ position: "absolute", left: "-9999px" }} alt="" />
      </noscript>
    </>
  );
}
