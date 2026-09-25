import { expect, it } from "vitest";
import { AiServiceError } from "../ai/provider-errors";
import { HttpError } from "../auth/http-error";
import { nextStage, toRunFailure } from "./jobs";

it("retains completed stage output after a failed later stage", () => {
  const saved = { research: { sources: ["https://example.com"] } };
  expect(nextStage("hooks", saved)).toEqual({ stage: "hooks", stages: saved });
});

it("preserves safe catalog errors for queued runs", () => {
  expect(toRunFailure(new HttpError(400, "Choose a supported Claude model", "AI_MODEL_NOT_ALLOWED"))).toEqual({
    code: "AI_MODEL_NOT_ALLOWED",
    message: "Choose a supported Claude model",
  });
});

it("stores stable AI failures without raw provider text", () => {
  expect(toRunFailure(new AiServiceError("AI_SETTINGS_INVALID", "Your Anthropic API key was rejected."))).toEqual({
    code: "AI_SETTINGS_INVALID",
    message: "Your Anthropic API key was rejected.",
  });
  expect(toRunFailure(new Error("provider leaked sk-ant-secret"))).toEqual({
    code: "GENERATION_FAILED",
    message: "Generation failed. Try again.",
  });
});

it.each(["AI_OUTPUT_INCOMPLETE", "AI_OUTPUT_INVALID"] as const)("preserves the safe %s failure", (code) => {
  expect(toRunFailure(new AiServiceError(code, "Claude returned a safe output error. Retry this stage."))).toEqual({
    code,
    message: "Claude returned a safe output error. Retry this stage.",
  });
});
