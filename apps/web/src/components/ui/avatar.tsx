"use client";
import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn, initials } from "@/lib/utils";

export function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return <AvatarPrimitive.Root className={cn("relative flex size-9 shrink-0 overflow-hidden rounded-full", className)} {...props} />;
}
export function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return <AvatarPrimitive.Image className={cn("aspect-square size-full object-cover", className)} {...props} />;
}
export function AvatarFallback({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return <AvatarPrimitive.Fallback className={cn("gradient-brand flex size-full items-center justify-center text-xs font-bold text-white", className)} {...props} />;
}

/** Convenience: avatar from user name + optional image. */
export function UserAvatar({ name, image, className }: { name?: string | null; image?: string | null; className?: string }) {
  return (
    <Avatar className={className}>
      {image ? <AvatarImage src={image} alt={name ?? ""} /> : null}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
