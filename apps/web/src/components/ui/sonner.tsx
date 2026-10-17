"use client";
import { Toaster as Sonner, toast } from "sonner";
import { useTheme } from "@/components/providers/theme-provider";

/** App-wide toaster. Use `import { toast } from "@/components/ui/sonner"` anywhere in client code. */
export function Toaster() {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme}
      position="top-right"
      richColors
      closeButton
      toastOptions={{ classNames: { toast: "!rounded-xl !border !border-border !bg-popover !text-popover-foreground" } }}
    />
  );
}

export { toast };
