import { expect, it, vi } from "vitest";
import type { CreationRun } from "../server/db/types";
import { AiServiceError } from "../server/ai/provider-errors";
import { describeRunFailure, handleRunFailure, loadAiForRun } from "./ai-for-run";

function run(owner: string, researchModel = "claude-sonnet-5", writingModel = "claude-opus-5") {
  return { id: `run-${owner}`, owner_id: owner, stage: "research", research_model: researchModel, writing_model: writingModel, ai_settings_revision: 1 } as CreationRun;
}

it("constructs Claude with the claimed run owner's key and snapshotted models", async () => {
  const getSettings = vi.fn()
    .mockResolvedValueOnce({ apiKey: "sk-ant-user-a", researchModel: "ignored", writingModel: "ignored", revision: 4 })
    .mockResolvedValueOnce({ apiKey: "sk-ant-user-b", researchModel: "ignored", writingModel: "ignored", revision: 8 });
  const createAi = vi.fn().mockReturnValue({});
  await loadAiForRun(run("a"), { getSettings, createAi });
  await loadAiForRun(run("b", "claude-opus-5", "claude-sonnet-5"), { getSettings, createAi });
  expect(createAi).toHaveBeenNthCalledWith(1, { apiKey: "sk-ant-user-a", researchModel: "claude-sonnet-5", writingModel: "claude-opus-5" });
  expect(createAi).toHaveBeenNthCalledWith(2, { apiKey: "sk-ant-user-b", researchModel: "claude-opus-5", writingModel: "claude-sonnet-5" });
});

it("rejects legacy runs without model snapshots before loading a key", async () => {
  const getSettings = vi.fn();
  const createAi = vi.fn();
  await expect(loadAiForRun({ ...run("a"), research_model: null } as CreationRun, { getSettings, createAi })).rejects.toMatchObject({ code: "AI_SETTINGS_REQUIRED" });
  expect(getSettings).not.toHaveBeenCalled();
  expect(createAi).not.toHaveBeenCalled();
});

it("invalidates only the loaded key revision and idempotently records the failure", async () => {
  const markInvalid = vi.fn();
  const fail = vi.fn();
  const error = new AiServiceError("AI_SETTINGS_INVALID", "Your Anthropic API key was rejected.");
  await handleRunFailure(run("a"), error, 4, { markInvalid, fail });
  expect(markInvalid).toHaveBeenCalledWith("a", 4);
  expect(fail).toHaveBeenCalledWith("run-a", "research", error);
});

it("persists credential-loading failures that processing did not record", async () => {
  const markInvalid = vi.fn();
  const fail = vi.fn();
  const error = new AiServiceError("AI_SETTINGS_REQUIRED", "Configure Claude in Settings before creating content.");
  await handleRunFailure(run("a"), error, undefined, { markInvalid, fail });
  expect(markInvalid).not.toHaveBeenCalled();
  expect(fail).toHaveBeenCalledWith("run-a", "research", error);
});

it("still records a run failure when invalidation fails", async () => {
  const fail = vi.fn();
  const error = new AiServiceError("AI_SETTINGS_INVALID", "Your Anthropic API key was rejected.");
  await expect(handleRunFailure(run("a"), error, 4, { markInvalid: vi.fn().mockRejectedValue(new Error("db unavailable")), fail })).rejects.toThrow("db unavailable");
  expect(fail).toHaveBeenCalledWith("run-a", "research", error);
});

it("describes a run failure with the stable code and provider request id only", () => {
  const traced = new AiServiceError("AI_PROVIDER_UNAVAILABLE", "Anthropic could not complete the request. Try again shortly.", "req_abc123");
  expect(describeRunFailure(run("a"), traced)).toBe("Run run-a failed at research: AI_PROVIDER_UNAVAILABLE (provider request req_abc123)");
  expect(describeRunFailure(run("a"), new AiServiceError("AI_SETTINGS_INVALID", "Your Anthropic API key was rejected."))).toBe("Run run-a failed at research: AI_SETTINGS_INVALID");
  expect(describeRunFailure(run("a"), new Error("sk-ant-secret leaked into the message"))).toBe("Run run-a failed at research: GENERATION_FAILED");
});
