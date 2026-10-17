import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { MAX_ACTIVE_API_KEYS, allowedScopes, listApiKeys } from "@/server/cabinet/api-keys";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { ApiKeysManager } from "@/components/cabinet/api-keys-manager";

export const metadata = { title: "API-ключи" };
export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const user = await requireUser("/account/api-keys");
  const keys = await listApiKeys(user.id);
  return (
    <>
      <PageHeader title="API-ключи" description="Доступ к ASAPawge GG из ваших скриптов, ботов и AI-агентов (REST API и MCP-сервер)." />
      <ApiKeysManager keys={keys} allowedScopes={[...allowedScopes(user.role)]} maxActive={MAX_ACTIVE_API_KEYS} />
      <p className="mt-6 text-sm text-muted-foreground">Документация: <Link href="/info/api" className="text-primary hover:underline">как подключиться к API и MCP</Link>.</p>
    </>
  );
}
