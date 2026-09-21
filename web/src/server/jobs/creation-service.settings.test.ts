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

import { retryRun, startCreationRun, startRevisionRun } from "./creation-service";

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

it("refuses a revision when the owner's key is no longer valid", async () => {
  mocks.query.mockReset();
  mocks.query.mockResolvedValue({ rowCount: 1, rows: [{}] });
  mocks.snapshot.mockRejectedValue(new AiServiceError("AI_SETTINGS_INVALID", "Revalidate or replace your Anthropic API key in Settings."));
  await expect(startRevisionRun("owner-a", "draft-1", "Sharpen the opening")).rejects.toMatchObject({ code: "AI_SETTINGS_INVALID", status: 409 });
  expect(mocks.enqueue).not.toHaveBeenCalled();
});

it("snapshots settings for a revision run the same way as a creation run", async () => {
  mocks.query.mockReset();
  mocks.query.mockResolvedValue({ rowCount: 1, rows: [{}] });
  await startRevisionRun("owner-a", "draft-1", "Sharpen the opening");
  expect(mocks.enqueue).toHaveBeenCalledWith(
    "owner-a",
    expect.objectContaining({ kind: "revision", draftId: "draft-1", direction: "Sharpen the opening" }),
    { researchModel: "claude-sonnet-5", writingModel: "claude-opus-5", revision: 3 },
    mocks.client,
  );
});

it("will not retry a legacy run that carries no model snapshot", async () => {
  mocks.query.mockReset();
  mocks.query.mockResolvedValue({ rows: [{ id: "run-legacy", owner_id: "owner-a", research_model: null, writing_model: null, ai_settings_revision: null }] });
  await expect(retryRun("owner-a", "run-legacy")).rejects.toMatchObject({ code: "AI_SETTINGS_REQUIRED", status: 409 });
  expect(mocks.query).toHaveBeenCalledTimes(1);
});
