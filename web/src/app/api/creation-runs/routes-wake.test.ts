import { afterEach, expect, it, vi } from "vitest";
import { HttpError } from "../../../server/auth/http-error";

const services = vi.hoisted(() => ({
  startCreationRun: vi.fn(),
  getRun: vi.fn(),
  retryRun: vi.fn(),
  chooseRunIdea: vi.fn(),
  chooseRunHook: vi.fn(),
  startRevisionRun: vi.fn(),
}));
const worker = vi.hoisted(() => ({
  scheduleWorkerWake: vi.fn(),
  registerWakeRequest: vi.fn(),
}));

vi.mock("../../../server/auth/require-user", () => ({ requireUser: async () => ({ id: "owner-a" }) }));
vi.mock("../../../server/jobs/creation-service", () => services);
vi.mock("../../../server/worker/schedule-wake", () => ({ scheduleWorkerWake: worker.scheduleWorkerWake }));
vi.mock("../../../server/worker/wake-request", () => ({ registerWakeRequest: worker.registerWakeRequest }));

import { POST as startRun } from "./route";
import { PATCH as retryRun } from "./[id]/route";
import { POST as choose } from "./[id]/choice/route";
import { POST as wake } from "./[id]/wake/route";
import { POST as revise } from "../posts/[draftId]/revise/route";

const runId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";
const run = { id: runId, status: "queued" };
const context = (id = runId) => ({ params: Promise.resolve({ id }) }) as never;
const draftContext = () => ({ params: Promise.resolve({ draftId }) }) as never;

afterEach(() => vi.clearAllMocks());

it("schedules a wake only after a new run is persisted", async () => {
  let resolveRun!: (value: typeof run) => void;
  services.startCreationRun.mockReturnValue(new Promise((resolve) => { resolveRun = resolve; }));
  const response = startRun(new Request("http://localhost/api/creation-runs", {
    method: "POST",
    body: JSON.stringify({ mode: "quick", entry: "find" }),
  }));

  await Promise.resolve();
  expect(worker.scheduleWorkerWake).not.toHaveBeenCalled();
  resolveRun(run);

  expect((await response).status).toBe(201);
  expect(worker.scheduleWorkerWake).toHaveBeenCalledOnce();
});

it("does not schedule when starting a run fails", async () => {
  services.startCreationRun.mockRejectedValue(new HttpError(409, "Already active"));
  const response = await startRun(new Request("http://localhost/api/creation-runs", {
    method: "POST",
    body: JSON.stringify({ mode: "quick", entry: "find" }),
  }));

  expect(response.status).toBe(409);
  expect(worker.scheduleWorkerWake).not.toHaveBeenCalled();
});

it.each([
  ["retry", () => { services.retryRun.mockResolvedValue(run); return retryRun(new Request("http://localhost"), context()); }, "retryRun"],
  ["idea choice", () => { services.chooseRunIdea.mockResolvedValue(run); return choose(new Request("http://localhost", { method: "POST", body: JSON.stringify({ kind: "idea", choiceId: "idea-1" }) }), context()); }, "chooseRunIdea"],
  ["hook choice", () => { services.chooseRunHook.mockResolvedValue(run); return choose(new Request("http://localhost", { method: "POST", body: JSON.stringify({ kind: "hook", choiceId: "hook-1" }) }), context()); }, "chooseRunHook"],
  ["revision", () => { services.startRevisionRun.mockResolvedValue(run); return revise(new Request("http://localhost", { method: "POST", body: JSON.stringify({ direction: "Make it sharper" }) }), draftContext()); }, "startRevisionRun"],
])("schedules a wake after a successful %s", async (_label, invoke, serviceName) => {
  const response = await invoke();

  expect(response.status).toBe(serviceName === "startRevisionRun" ? 201 : 200);
  expect(services[serviceName as keyof typeof services]).toHaveBeenCalledOnce();
  expect(worker.scheduleWorkerWake).toHaveBeenCalledOnce();
});

it("returns 404 for an invalid manual wake run id", async () => {
  const response = await wake(new Request("http://localhost", { method: "POST" }), context("not-a-uuid"));

  expect(response.status).toBe(404);
  expect(worker.registerWakeRequest).not.toHaveBeenCalled();
  expect(worker.scheduleWorkerWake).not.toHaveBeenCalled();
});

it.each([
  [404, "Creation run not found"],
  [409, "Only a queued run can wake the worker"],
])("preserves a %i manual wake service error", async (status, message) => {
  worker.registerWakeRequest.mockRejectedValue(new HttpError(status, message));

  const response = await wake(new Request("http://localhost", { method: "POST" }), context());

  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: message });
  expect(worker.scheduleWorkerWake).not.toHaveBeenCalled();
});

it("schedules an accepted manual wake", async () => {
  worker.registerWakeRequest.mockResolvedValue("scheduled");

  const response = await wake(new Request("http://localhost", { method: "POST" }), context());

  expect(await response.json()).toEqual({ status: "scheduled" });
  expect(worker.registerWakeRequest).toHaveBeenCalledWith("owner-a", runId);
  expect(worker.scheduleWorkerWake).toHaveBeenCalledOnce();
});

it("returns cooldown without scheduling another wake", async () => {
  worker.registerWakeRequest.mockResolvedValue("cooldown");

  const response = await wake(new Request("http://localhost", { method: "POST" }), context());

  expect(await response.json()).toEqual({ status: "cooldown" });
  expect(worker.scheduleWorkerWake).not.toHaveBeenCalled();
});
