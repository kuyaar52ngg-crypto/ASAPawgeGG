import * as React from "react";

/**
 * Minimal, XSS-safe Markdown renderer for product descriptions.
 * Supports: #/##/### headings, **bold**, *italic*, `code`, [text](http(s)://link), "-"/"*" and "1." lists, paragraphs.
 * Everything else is rendered as plain text (React escapes it). No HTML is ever injected.
 */

const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(INLINE).filter((s) => s !== "").map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={key} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={key} className="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[0.85em]">{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    if (link) {
      return (
        <a key={key} href={link[2]} target="_blank" rel="nofollow noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
          {link[1]}
        </a>
      );
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

export function SafeMarkdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length === 0) return;
    const k = `p${blocks.length}`;
    blocks.push(
      <p key={k}>
        {para.map((l, i) => (
          <React.Fragment key={i}>
            {i > 0 && <br />}
            {renderInline(l, `${k}-${i}`)}
          </React.Fragment>
        ))}
      </p>,
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const k = `l${blocks.length}`;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={k} className={list.ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}>
        {list.items.map((it, i) => (
          <li key={i}>{renderInline(it, `${k}-${i}`)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.+)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      const k = `h${blocks.length}`;
      const cls = "font-display font-semibold text-foreground";
      blocks.push(h[1]!.length === 1 ? <h3 key={k} className={`${cls} text-lg`}>{renderInline(h[2]!, k)}</h3> : <h4 key={k} className={`${cls} text-base`}>{renderInline(h[2]!, k)}</h4>);
    } else if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flushList();
      list = list ?? { ordered, items: [] };
      list.items.push((ul ?? ol)![1]!);
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();

  return <div className={["space-y-3 text-[15px] leading-relaxed text-muted-foreground", className].filter(Boolean).join(" ")}>{blocks}</div>;
}
