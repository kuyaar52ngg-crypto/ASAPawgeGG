import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("enqueueJob", () => {
  it("returns { ok: false } immediately when WORKER_URL is empty (no network call)", async () => {
    vi.stubEnv("WORKER_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { enqueueJob } = await import("./worker");
    await expect(enqueueJob("fulfill_order", { orderId: "x" })).resolves.toEqual({ ok: false, error: "worker disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
