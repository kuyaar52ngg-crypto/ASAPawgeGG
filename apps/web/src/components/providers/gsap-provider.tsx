"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import { registerGsap, ScrollTrigger } from "@/lib/gsap";

/** Registers GSAP plugins once and refreshes ScrollTrigger on route changes. */
export function GsapProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  React.useEffect(() => {
    registerGsap();
  }, []);
  React.useEffect(() => {
    const t = setTimeout(() => ScrollTrigger.refresh(), 150);
    return () => clearTimeout(t);
  }, [pathname]);
  return <>{children}</>;
}
