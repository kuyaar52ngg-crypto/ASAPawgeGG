/** Incremental parser for the `data: {json}\n\n` stream of POST /api/ai/chat. Pure, unit-tested. */

export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string }
  | { type: "done"; mock: boolean; provider: string }
  | { type: "error"; message: string };

export class SseParser {
  private buf = "";

  push(chunk: string): ChatStreamEvent[] {
    this.buf += chunk;
    const out: ChatStreamEvent[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf("\n\n")) >= 0) {
      const frame = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        const ev = JSON.parse(data) as ChatStreamEvent;
        if (ev && typeof ev === "object" && "type" in ev) out.push(ev);
      } catch {
        /* ignore malformed frame */
      }
    }
    return out;
  }
}
