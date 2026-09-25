import { afterEach, expect, it, vi } from "vitest";
import { wakeWorker } from "./wake";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("calls only the worker health path", async () => {
  vi.stubEnv("WORKER_URL", "https://cadence-worker.onrender.com/internal/path?private=value");
  const fetcher = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));

  await expect(wakeWorker(fetcher)).resolves.toEqual({ outcome: "reachable", status: 200 });
  expect(fetcher).toHaveBeenCalledWith(
    "https://cadence-worker.onrender.com/health",
    expect.objectContaining({ method: "GET", cache: "no-store", signal: expect.any(AbortSignal) }),
  );
});

it("returns a safe failed result for a non-OK response", async () => {
  vi.stubEnv("WORKER_URL", "https://cadence-worker.onrender.com");
  const fetcher = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));

  await expect(wakeWorker(fetcher)).resolves.toEqual({ outcome: "failed", status: 503 });
});

it("treats an abort timeout as a wake request without exposing the URL", async () => {
  vi.useFakeTimers();
  vi.stubEnv("WORKER_URL", "https://cadence-worker.onrender.com/private?token=secret");
  const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));

  const pending = wakeWorker(fetcher as typeof fetch);
  await vi.advanceTimersByTimeAsync(8_000);
  await expect(pending).resolves.toEqual({ outcome: "requested" });
});

it("returns a safe failed result when the network request throws", async () => {
  vi.stubEnv("WORKER_URL", "https://cadence-worker.onrender.com/private?token=secret");
  const fetcher = vi.fn().mockRejectedValue(new Error("network included https://cadence-worker.onrender.com/private?token=secret"));

  const result = await wakeWorker(fetcher);
  expect(result).toEqual({ outcome: "failed" });
  expect(JSON.stringify(result)).not.toContain("cadence-worker.onrender.com");
  expect(JSON.stringify(result)).not.toContain("token=secret");
});
