// Alias: POST /api/payments/{provider}/webhook  ->  same handler as /api/payments/webhook/{provider}
export { POST } from "../../webhook/[provider]/route";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
