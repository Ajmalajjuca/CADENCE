import { beforeEach, expect, it, vi } from "vitest";
import { AiServiceError } from "../ai/provider-errors";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  enqueue: vi.fn(),
  snapshot: vi.fn(),
  lock: vi.fn(),
  client: { query: vi.fn() },
}));

vi.mock("../db/client", () => ({ getPool: () => ({ query: mocks.query }) }));
vi.mock("../db/jobs", () => ({ enqueueCreationRun: mocks.enqueue }));
vi.mock("../../features/settings/ai-settings", () => ({
  getValidAiSettingsSnapshot: mocks.snapshot,
  withOwnerAiSettingsLock: mocks.lock,
}));

import { startCreationRun } from "./creation-service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query
    .mockResolvedValueOnce({ rows: [{ onboarding_complete: true }] })
    .mockResolvedValueOnce({ rows: [{ count: "0" }] });
  mocks.snapshot.mockResolvedValue({ researchModel: "claude-sonnet-5", writingModel: "claude-opus-5", revision: 3 });
  mocks.enqueue.mockResolvedValue({ id: "run-1" });
  mocks.lock.mockImplementation(async (_ownerId, callback) => callback(mocks.client));
});

it("snapshots valid AI settings when a creation run is queued", async () => {
  await startCreationRun("owner-a", { mode: "quick", entry: "topic", topic: "AI operations" });
  expect(mocks.lock).toHaveBeenCalledWith("owner-a", expect.any(Function));
  expect(mocks.snapshot).toHaveBeenCalledWith("owner-a", mocks.client);
  expect(mocks.enqueue).toHaveBeenCalledWith(
    "owner-a",
    expect.objectContaining({ entry: "topic", topic: "AI operations" }),
    { researchModel: "claude-sonnet-5", writingModel: "claude-opus-5", revision: 3 },
    mocks.client,
  );
});

it("does not enqueue when the owner has no valid AI settings", async () => {
  mocks.snapshot.mockRejectedValue(new AiServiceError("AI_SETTINGS_REQUIRED", "Configure Claude in Settings before creating content."));
  await expect(startCreationRun("owner-a", { mode: "quick", entry: "topic", topic: "AI operations" })).rejects.toMatchObject({ code: "AI_SETTINGS_REQUIRED" });
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
