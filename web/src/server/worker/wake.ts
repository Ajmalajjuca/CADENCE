import { readServerConfig } from "../config";

export type WorkerWakeResult = { outcome: "reachable" | "requested" | "failed"; status?: number };

export async function wakeWorker(fetcher: typeof fetch = fetch): Promise<WorkerWakeResult> {
  const { WORKER_URL } = readServerConfig("workerWake");
  const health = new URL("/health", WORKER_URL).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(health, { method: "GET", cache: "no-store", signal: controller.signal });
    return response.ok
      ? { outcome: "reachable", status: response.status }
      : { outcome: "failed", status: response.status };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { outcome: "requested" };
    return { outcome: "failed" };
  } finally {
    clearTimeout(timer);
  }
}
