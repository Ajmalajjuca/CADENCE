import { expect, it } from "vitest";
import { listModels, requireAllowedModel } from "./model-catalog";

it("offers only the curated current models for research and writing", () => {
  expect(listModels("research").map(model => model.id)).toEqual(["claude-sonnet-5", "claude-opus-5"]);
  expect(listModels("writing").map(model => model.id)).toEqual(["claude-sonnet-5", "claude-opus-5"]);
  expect(requireAllowedModel("claude-sonnet-5", "writing").recommended).toBe(true);
});

it("rejects models outside the curated catalog", () => {
  expect(() => requireAllowedModel("claude-retired", "research")).toThrow(/supported/i);
});
