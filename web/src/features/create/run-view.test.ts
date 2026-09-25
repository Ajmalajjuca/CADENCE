import { expect, it } from "vitest";
import type { CreationRunJson, RunStage, RunStatus } from "../../server/db/types";
import { deriveRunView, POST_STEPS } from "./run-view";

const updatedAt = "2026-09-25T05:03:25.138Z";

function makeRun(overrides: Partial<CreationRunJson> = {}): CreationRunJson {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    owner_id: "22222222-2222-4222-8222-222222222222",
    kind: "post",
    mode: "quick",
    entry: "find",
    topic: "",
    direction: "",
    idea_id: null,
    draft_id: null,
    selected_idea: null,
    selected_hook: null,
    stage: "idea",
    status: "queued",
    stages: {},
    prompt_version: "cadence-v1",
    model: "",
    research_model: "claude-sonnet-5",
    writing_model: "claude-sonnet-5",
    ai_settings_revision: 1,
    usage: {},
    error_code: null,
    error_message: null,
    attempts: 0,
    lease_owner: null,
    lease_until: null,
    created_at: updatedAt,
    updated_at: updatedAt,
    ...overrides,
  };
}

it.each([
  [5_000, "Preparing your run", undefined],
  [9_999, "Preparing your run", undefined],
  [10_000, "Worker is waking up", undefined],
  [30_000, "Worker is waking up", undefined],
  [90_000, "Worker is waking up", undefined],
  [90_001, "This is taking longer than expected", "wake"],
])("derives queued copy at %sms", (age, title, action) => {
  expect(deriveRunView(makeRun(), Date.parse(updatedAt) + age))
    .toMatchObject({ title, action: action ? { kind: action } : null });
});

it("treats malformed or future queue timestamps as a fresh run", () => {
  expect(deriveRunView(makeRun({ updated_at: "not-a-date" }), Date.now()).title).toBe("Preparing your run");
  expect(deriveRunView(makeRun(), Date.parse(updatedAt) - 60_000).title).toBe("Preparing your run");
});

it.each([
  ["idea", "Finding an idea"],
  ["research", "Researching the angle"],
  ["hooks", "Creating hooks"],
  ["draft", "Writing your draft"],
  ["style", "Polishing your voice"],
])("describes a running %s stage", (stage, title) => {
  const view = deriveRunView(makeRun({ status: "running", stage: stage as RunStage }), Date.now());
  expect(view).toMatchObject({ title, tone: "progress", activeStage: stage, action: null });
  expect(view.steps.find((step) => step.stage === stage)).toMatchObject({ state: "active" });
});

it.each([
  ["idea", "Choose an idea"],
  ["hooks", "Choose a hook"],
])("describes a waiting %s choice without requiring a selection", (stage, title) => {
  const view = deriveRunView(makeRun({
    status: "waiting_for_user",
    stage: stage as RunStage,
    selected_idea: null,
    selected_hook: null,
  }), Date.now());

  expect(view).toMatchObject({ title, tone: "waiting", activeStage: stage, action: null });
});

it("marks every post step complete and links to a completed draft", () => {
  const view = deriveRunView(makeRun({
    status: "complete",
    stage: "ready",
    draft_id: "33333333-3333-4333-8333-333333333333",
  }), Date.now());

  expect(view).toMatchObject({
    title: "Your draft is ready",
    tone: "success",
    activeStage: null,
    action: { kind: "review", draftId: "33333333-3333-4333-8333-333333333333" },
  });
  expect(view.steps).toHaveLength(POST_STEPS.length);
  expect(view.steps.every((step) => step.state === "complete")).toBe(true);
});

it("keeps a defensive complete state when the draft id is absent", () => {
  expect(deriveRunView(makeRun({ status: "complete", stage: "ready", draft_id: null }), Date.now()))
    .toMatchObject({ title: "Your draft is ready", action: null });
});

it("uses a short journey for revision runs", () => {
  const running = deriveRunView(makeRun({ kind: "revision", entry: "revision", stage: "revision", status: "running" }), Date.now());
  expect(running).toMatchObject({ title: "Revising your draft", activeStage: "revision" });
  expect(running.steps).toEqual([{ stage: "revision", label: "Revise your draft", state: "active" }]);
});

it.each([
  ["AI_SETTINGS_REQUIRED", "settings"],
  ["AI_SETTINGS_INVALID", "settings"],
  ["AI_MODEL_UNAVAILABLE", "settings"],
  ["AI_CREDIT_REQUIRED", "settings"],
  ["AI_RATE_LIMITED", "retry"],
  ["AI_PROVIDER_UNAVAILABLE", "retry"],
  ["AI_OUTPUT_INCOMPLETE", "retry"],
  ["AI_OUTPUT_INVALID", "retry"],
  ["GENERATION_FAILED", "retry"],
  ["UNKNOWN_CODE", "retry"],
  [null, "retry"],
])("maps %s to a safe %s action", (code, action) => {
  const view = deriveRunView(makeRun({ status: "failed", error_code: code }), Date.now());
  expect(view.action?.kind).toBe(action);
  expect(`${view.title} ${view.description}`).not.toContain("provider-secret");
});

it("never passes an unknown stored error message to the view", () => {
  const view = deriveRunView(makeRun({
    status: "failed",
    error_code: "UNKNOWN_CODE",
    error_message: "provider-secret raw response",
  }), Date.now());

  expect(view).toMatchObject({ title: "We could not finish this stage", tone: "danger", action: { kind: "retry" } });
  expect(JSON.stringify(view)).not.toContain("provider-secret");
});

it("falls back safely for an unexpected persisted status", () => {
  const view = deriveRunView(makeRun({ status: "mystery" as RunStatus }), Date.now());
  expect(view).toMatchObject({ title: "Checking your run", tone: "neutral", action: null });
});
