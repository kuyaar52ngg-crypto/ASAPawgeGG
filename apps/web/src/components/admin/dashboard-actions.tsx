"use client";
import * as React from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import { useRunAction } from "./use-run-action";
import { aiSummaryAction, refreshMetricsAction, type AiSummaryData } from "@/app/admin/actions";

export function RefreshButton() {
  const { run, pending } = useRunAction();
  return (
    <Button variant="outline" size="sm" loading={pending} onClick={() => run(() => refreshMetricsAction(), { success: "Данные обновлены" })}>
      {!pending && <RefreshCw />} Обновить
    </Button>
  );
}

/** «AI-сводка» button + result card. */
export function AiSummary({ days }: { days: 7 | 30 | 90 }) {
  const [data, setData] = React.useState<AiSummaryData | null>(null);
  const [pending, start] = React.useTransition();

  function generate() {
    start(async () => {
      try {
        const r = await aiSummaryAction({ days });
        if (r.ok) setData(r.data);
        else toast.error(r.error);
      } catch {
        toast.error("Не удалось получить сводку");
      }
    });
  }

  return (
    <div className="grid gap-3">
      <div>
        <Button size="sm" onClick={generate} loading={pending}>
          {!pending && <Sparkles />} AI-сводка
        </Button>
      </div>
      {data && (
        <Card className="gradient-border p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base font-semibold">Сводка за {days} дн.</h3>
            {data.mock ? <Badge variant="warning">Автосводка без AI — провайдер не подключён</Badge> : <Badge variant="success">{data.provider} · {data.model}</Badge>}
          </div>
          <div className="text-sm leading-relaxed whitespace-pre-line">{data.text}</div>
        </Card>
      )}
    </div>
  );
}
