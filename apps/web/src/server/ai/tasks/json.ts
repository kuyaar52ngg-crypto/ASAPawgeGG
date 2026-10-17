import type { z } from "zod";

/** Extract the first JSON object from model output (tolerates code fences / chatter) and validate it. Returns null when invalid. */
export function parseModelJson<S extends z.ZodType>(text: string, schema: S): z.infer<S> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
