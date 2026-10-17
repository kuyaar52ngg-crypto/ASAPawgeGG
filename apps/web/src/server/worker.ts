import "server-only";
import type { JobName } from "@asap/shared";
import { env } from "@/lib/env";

export interface EnqueueResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

/**
 * Enqueue a background job on the Python worker.
 * Contract: POST {WORKER_URL}/internal/jobs/{name}  Authorization: Bearer {WORKER_INTERNAL_TOKEN}
 *           body: { args: {...}, delaySeconds?: number }  ->  { ok: true, jobId }
 * Never throws: failures are returned so callers can fall back (e.g. fulfil inline / retry via cron).
 */
export async function enqueueJob(name: JobName, args: Record<string, unknown> = {}, opts: { delaySeconds?: number } = {}): Promise<EnqueueResult> {
  try {
    const res = await fetch(`${env.workerUrl}/internal/jobs/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.workerToken}` },
      body: JSON.stringify({ args, delaySeconds: opts.delaySeconds }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `worker responded ${res.status}` };
    const json = (await res.json()) as { jobId?: string };
    return { ok: true, jobId: json.jobId };
  } catch (err) {
    console.warn(`[worker] enqueue ${name} failed:`, (err as Error).message);
    return { ok: false, error: (err as Error).message };
  }
}
