// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCreationRun } from "./use-creation-run";

function apiRun(status: string) {
  return {
    id: "run-1",
    status,
    stage: "idea",
    updated_at: "2026-09-25T05:03:25.138Z",
  };
}

function ok(status: string) {
  return { ok: true, json: () => Promise.resolve(apiRun(status)) };
}

function Probe() {
  const { run, loading, error, refresh } = useCreationRun("run-1");
  return <div>
    <p data-testid="status">{run?.status ?? "none"}</p>
    <p data-testid="loading">{String(loading)}</p>
    <p role="alert">{error}</p>
    <button onClick={() => void refresh()}>Refresh</button>
  </div>;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("fetches the run immediately and exposes its loading state", async () => {
  const fetchMock = vi.fn().mockResolvedValue(ok("queued"));
  vi.stubGlobal("fetch", fetchMock);

  render(<Probe />);
  expect(screen.getByTestId("loading")).toHaveTextContent("true");
  await settle();

  expect(fetchMock).toHaveBeenCalledWith("/api/creation-runs/run-1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(screen.getByTestId("status")).toHaveTextContent("queued");
  expect(screen.getByTestId("loading")).toHaveTextContent("false");
});

it("self-schedules while queued or running", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(ok("queued"))
    .mockResolvedValueOnce(ok("running"))
    .mockResolvedValueOnce(ok("running"));
  vi.stubGlobal("fetch", fetchMock);
  render(<Probe />);
  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("status")).toHaveTextContent("running");

  await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it.each(["failed", "waiting_for_user", "complete"])("stops polling a %s run", async (status) => {
  const fetchMock = vi.fn().mockResolvedValue(ok(status));
  vi.stubGlobal("fetch", fetchMock);
  render(<Probe />);
  await settle();

  await act(async () => { await vi.advanceTimersByTimeAsync(7_500); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("pauses while hidden and refreshes immediately when visible", async () => {
  const fetchMock = vi.fn().mockResolvedValue(ok("queued"));
  vi.stubGlobal("fetch", fetchMock);
  render(<Probe />);
  await settle();

  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  await act(async () => { await vi.advanceTimersByTimeAsync(7_500); });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(2);

  await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("aborts an in-flight request on unmount", () => {
  let signal: AbortSignal | undefined;
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return new Promise(() => undefined);
  });
  vi.stubGlobal("fetch", fetchMock);

  const view = render(<Probe />);
  expect(signal?.aborted).toBe(false);
  view.unmount();
  expect(signal?.aborted).toBe(true);
});

it("preserves the last successful run when a later poll fails", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(ok("queued"))
    .mockRejectedValueOnce(new Error("network includes secret details"));
  vi.stubGlobal("fetch", fetchMock);
  render(<Probe />);
  await settle();

  await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });

  expect(screen.getByTestId("status")).toHaveTextContent("queued");
  expect(screen.getByRole("alert")).toHaveTextContent("Could not load your saved progress.");
  expect(screen.getByRole("alert")).not.toHaveTextContent("secret details");
});

it("allows an explicit refresh after a terminal response", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(ok("failed"))
    .mockResolvedValueOnce(ok("queued"));
  vi.stubGlobal("fetch", fetchMock);
  render(<Probe />);
  await settle();

  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await settle();

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("status")).toHaveTextContent("queued");
});
