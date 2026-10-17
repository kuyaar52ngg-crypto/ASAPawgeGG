import Link from "next/link";
import { requireSellerPage } from "@/server/cabinet/seller-context";
import { MAX_ACTIVE_API_KEYS, allowedScopes, listApiKeys } from "@/server/cabinet/api-keys";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { ApiKeysManager } from "@/components/cabinet/api-keys-manager";

export const metadata = { title: "API-ключи продавца" };
export const dynamic = "force-dynamic";

export default async function SellerApiKeysPage() {
  const ctx = await requireSellerPage();
  const keys = await listApiKeys(ctx.user.id);
  return (
    <>
      <PageHeader title="API-ключи" description="Автоматизируйте магазин: создание товаров, загрузка ключей и статистика через REST API или MCP-сервер (AI-агенты)." />
      <ApiKeysManager keys={keys} allowedScopes={[...allowedScopes(ctx.user.role)]} maxActive={MAX_ACTIVE_API_KEYS} />
      <p className="mt-6 text-sm text-muted-foreground">Документация: <Link href="/info/api" className="text-primary hover:underline">как подключиться к API и MCP</Link>.</p>
    </>
  );
}
