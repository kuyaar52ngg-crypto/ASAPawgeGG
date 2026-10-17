import { redirect } from "next/navigation";

// Legacy path from docs/CONTRACTS.md §17 — AI logs live at /admin/ai-logs.
export default function AiRedirect() {
  redirect("/admin/ai-logs");
}
