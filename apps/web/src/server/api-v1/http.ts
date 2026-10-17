import "server-only";
import { z } from "zod";
import { ApiHttpError } from "@/server/api-keys";
import type { ActionFailure } from "@/server/cabinet/result";

/** Parses + validates a JSON body; throws ApiHttpError (400 invalid JSON / 422 validation). */
export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiHttpError(400, "invalid_json", "Некорректный JSON в теле запроса");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiHttpError(422, "validation_error", parsed.error.issues[0]?.message ?? "Ошибка валидации", z.flattenError(parsed.error));
  return parsed.data;
}

/** Parses URL search params with a zod schema; throws 422 on invalid values. */
export function readQuery<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  const parsed = schema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) throw new ApiHttpError(422, "validation_error", parsed.error.issues[0]?.message ?? "Некорректные параметры запроса", z.flattenError(parsed.error));
  return parsed.data;
}

/** Converts a failed service ActionResult into an HTTP error. */
export function failToHttp(f: ActionFailure, status = 422): ApiHttpError {
  return new ApiHttpError(f.fieldErrors && Object.keys(f.fieldErrors).length ? 422 : status, f.fieldErrors ? "validation_error" : "request_failed", f.error, f.fieldErrors);
}

export function baseUrl(): string {
  return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
