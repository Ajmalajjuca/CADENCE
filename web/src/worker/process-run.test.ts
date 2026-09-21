import { expect, it } from "vitest";
import { processCreationRun, type ProcessDependencies } from "./process-run";
import type { CreationRun } from "../server/db/types";

it("keeps completed research when hook generation fails", async () => {
  const savedResearch = { topic: "AI", sources: [{ url: "https://example.com" }] };
  const run = { id: "run-1", owner_id: "a", stage: "hooks", status: "running", mode: "quick", stages: { research: savedResearch }, selected_idea: { title: "AI" } } as unknown as CreationRun;
  let failedStage = "";
  const deps = {
    getVoice: async () => ({ stories: [] }),
    ai: { makeHooks: async () => { throw new Error("rate limit"); } },
    save: async () => { throw new Error("must not save"); },
    fail: async (_runId: string, stage: string) => { failedStage = stage; },
  } as unknown as ProcessDependencies;
  await expect(processCreationRun(run, deps)).rejects.toThrow("rate limit");
  expect(failedStage).toBe("hooks");
  expect(run.stages.research).toEqual(savedResearch);
});
