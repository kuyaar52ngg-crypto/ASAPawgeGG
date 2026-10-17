"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeBlock } from "./code-block";

export interface ClientSnippet {
  id: string;
  label: string;
  hint: string;
  lang: string;
  code: string;
}

/** Tabbed MCP client configs (Claude Desktop / Claude Code / Cursor). */
export function ClientTabs({ snippets }: { snippets: ClientSnippet[] }) {
  return (
    <Tabs defaultValue={snippets[0]?.id}>
      <TabsList className="flex-wrap">
        {snippets.map((s) => (
          <TabsTrigger key={s.id} value={s.id}>
            {s.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {snippets.map((s) => (
        <TabsContent key={s.id} value={s.id} className="space-y-3">
          <p className="text-sm text-muted-foreground">{s.hint}</p>
          <CodeBlock code={s.code} lang={s.lang} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
