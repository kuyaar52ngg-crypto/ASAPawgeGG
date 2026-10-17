import { redirect } from "next/navigation";

// Legacy path from docs/CONTRACTS.md §17 — the moderation queue lives at /admin/products.
export default function ModerationRedirect() {
  redirect("/admin/products?status=PENDING_REVIEW");
}
