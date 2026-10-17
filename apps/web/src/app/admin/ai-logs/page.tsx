import { prisma, type Prisma } from "@asap/db";
import { requireRole } from "@/server/auth/session";
import { ADMIN_PAGE_SIZE, pageParam, strParam } from "@/server/admin/action";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterPills, Pager, href } from "@/components/admin/common";
import { fmtDateTime } from "@/components/admin/labels";
import { Sparkles } from "lucide-react";

export const metadata = { title: "Админка · AI-логи" };
export const dynamic = "force-dynamic";

const pretty = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

export default async function AdminAiLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const task = strParam(sp.task);
  const status = ["ok", "error"].includes(strParam(sp.status)) ? strParam(sp.status) : "";
  const page = pageParam(sp.page);

  const where: Prisma.AiLogWhereInput = { ...(task ? { task } : {}), ...(status ? { ok: status === "ok" } : {}) };
  const [total, rows, tasks, totals] = await Promise.all([
    prisma.aiLog.count({ where }),
    prisma.aiLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * ADMIN_PAGE_SIZE, take: ADMIN_PAGE_SIZE }),
    prisma.aiLog.groupBy({ by: ["task"], _count: { _all: true }, orderBy: { task: "asc" } }),
    prisma.aiLog.aggregate({ where, _sum: { tokensIn: true, tokensOut: true }, _avg: { latencyMs: true } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const base = { task, status };

  return (
    <>
      <PageHeader
        title="AI-логи"
        description={`Вызовов: ${total} · токенов: ${(totals._sum.tokensIn ?? 0) + (totals._sum.tokensOut ?? 0)} · средняя задержка: ${Math.round(totals._avg.latencyMs ?? 0)} мс`}
      />
      <FilterPills
        active={task}
        items={[{ key: "", label: "Все задачи", href: href("/admin/ai-logs", { status }) }, ...tasks.map((t) => ({ key: t.task, label: t.task, count: t._count._all, href: href("/admin/ai-logs", { ...base, task: t.task }) }))]}
      />
      <FilterPills
        active={status}
        items={[
          { key: "", label: "Любой результат", href: href("/admin/ai-logs", { task }) },
          { key: "ok", label: "Успешные", href: href("/admin/ai-logs", { task, status: "ok" }) },
          { key: "error", label: "С ошибкой", href: href("/admin/ai-logs", { task, status: "error" }) },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState icon={<Sparkles />} title="Вызовов пока нет" description="Логи появятся после модерации товаров, AI-сводок и советов по спорам." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Время</TableHead><TableHead>Задача</TableHead><TableHead>Провайдер</TableHead><TableHead className="text-right">Токены</TableHead><TableHead className="text-right">мс</TableHead><TableHead>Данные</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDateTime(r.createdAt)}</TableCell>
                <TableCell><Badge variant={r.ok ? "secondary" : "destructive"}>{r.task}</Badge></TableCell>
                <TableCell className="text-xs">{r.provider}<br /><span className="text-muted-foreground">{r.model}</span></TableCell>
                <TableCell className="text-right text-xs tabular-nums">{r.tokensIn} / {r.tokensOut}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{r.latencyMs}</TableCell>
                <TableCell className="max-w-md">
                  <details className="text-xs">
                    <summary className="cursor-pointer text-primary">{r.ok ? "вход / выход" : (r.error ?? "ошибка").slice(0, 60)}</summary>
                    <div className="mt-2 space-y-2">
                      {r.error && <p className="text-destructive">{r.error}</p>}
                      {r.input != null && <pre className="max-h-48 overflow-auto rounded-lg bg-foreground/5 p-2 whitespace-pre-wrap break-words"><b>вход</b>{"\n"}{pretty(r.input)}</pre>}
                      {r.output != null && <pre className="max-h-48 overflow-auto rounded-lg bg-foreground/5 p-2 whitespace-pre-wrap break-words"><b>выход</b>{"\n"}{pretty(r.output)}</pre>}
                    </div>
                  </details>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Pager page={page} pageCount={pageCount} hrefFor={(p) => href("/admin/ai-logs", { ...base, page: p })} />
    </>
  );
}
