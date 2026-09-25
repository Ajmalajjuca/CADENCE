import { afterEach, expect, it, vi } from "vitest";
import { ServerConfigurationError } from "../config-error";

const worker = vi.hoisted(() => ({ wakeWorker: vi.fn() }));

vi.mock("./wake", () => worker);

import { scheduleWorkerWake } from "./schedule-wake";

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

it("runs the wake after the response lifecycle", async () => {
  const callbacks: Array<() => Promise<void>> = [];
  worker.wakeWorker.mockResolvedValue({ outcome: "reachable", status: 200 });

  scheduleWorkerWake((callback) => callbacks.push(callback as () => Promise<void>));

  expect(worker.wakeWorker).not.toHaveBeenCalled();
  await callbacks[0]();
  expect(worker.wakeWorker).toHaveBeenCalledOnce();
});

it("logs only a safe status when the worker returns a failed result", async () => {
  const callbacks: Array<() => Promise<void>> = [];
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  worker.wakeWorker.mockResolvedValue({ outcome: "failed", status: 503 });

  scheduleWorkerWake((callback) => callbacks.push(callback as () => Promise<void>));
  await callbacks[0]();

  expect(log).toHaveBeenCalledWith("Worker wake failed with status 503.");
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/https?:|owner|run/i);
});

it("contains thrown configuration errors without exposing their messages", async () => {
  const callbacks: Array<() => Promise<void>> = [];
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  worker.wakeWorker.mockRejectedValue(new ServerConfigurationError("WORKER_URL contains https://secret.example/run/owner-123"));

  scheduleWorkerWake((callback) => callbacks.push(callback as () => Promise<void>));
  await expect(callbacks[0]()).resolves.toBeUndefined();

  expect(log).toHaveBeenCalledWith("Worker wake failed: configuration.");
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret.example");
  expect(JSON.stringify(log.mock.calls)).not.toContain("owner-123");
});

it("contains unexpected thrown errors without exposing their messages", async () => {
  const callbacks: Array<() => Promise<void>> = [];
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  worker.wakeWorker.mockRejectedValue(new Error("request failed for https://secret.example/run/run-123"));

  scheduleWorkerWake((callback) => callbacks.push(callback as () => Promise<void>));
  await expect(callbacks[0]()).resolves.toBeUndefined();

  expect(log).toHaveBeenCalledWith("Worker wake failed: unexpected.");
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret.example");
  expect(JSON.stringify(log.mock.calls)).not.toContain("run-123");
});
