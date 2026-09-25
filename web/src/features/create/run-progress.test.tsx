// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CreationRunJson } from "../../server/db/types";

const polling = vi.hoisted(() => ({ useCreationRun: vi.fn() }));
vi.mock("./use-creation-run", () => polling);

import { RunProgress } from "./run-progress";

const refresh = vi.fn().mockResolvedValue(undefined);
const updatedAt = "2026-09-25T05:03:30.000Z";

function run(overrides: Partial<CreationRunJson> = {}): CreationRunJson {
  return {
    id: "run-1",
    owner_id: "owner-1",
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
    usage: {},
    research_model: "claude-sonnet-5",
    writing_model: "claude-sonnet-5",
    ai_settings_revision: 1,
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

function mockRun(overrides: Partial<CreationRunJson> = {}) {
  polling.useCreationRun.mockReturnValue({ run: run(overrides), loading: false, error: "", refresh });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("explains a cold worker and lets the user leave", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-25T05:04:00Z"));
  mockRun();
  render(<RunProgress runId="run-1" />);

  expect(screen.getByRole("heading", { name: "Worker is waking up" })).toBeInTheDocument();
  expect(screen.getByText(/You can leave this page/)).toBeInTheDocument();
  expect(screen.getByText("Find an idea")).toHaveAttribute("data-state", "active");
});

it("offers a manual wake after ninety seconds", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-25T05:04:00Z"));
  mockRun({ updated_at: "2026-09-25T05:00:00Z" });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "scheduled" }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<RunProgress runId="run-1" />);

  fireEvent.click(screen.getByRole("button", { name: "Wake worker and check again" }));

  expect(fetchMock).toHaveBeenCalledWith("/api/creation-runs/run-1/wake", { method: "POST" });
  expect(await screen.findByText("Wake request sent. Checking again…")).toBeVisible();
  expect(screen.getByRole("button", { name: "Wake worker and check again" })).toBeDisabled();
  expect(refresh).toHaveBeenCalledOnce();
});

it.each(["AI_SETTINGS_INVALID", "AI_CREDIT_REQUIRED"])("links %s failures to Settings", (errorCode) => {
  mockRun({ status: "failed", error_code: errorCode });
  render(<RunProgress runId="run-1" />);

  expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "/settings");
  expect(screen.queryByText(/provider raw/i)).not.toBeInTheDocument();
});

it.each(["AI_RATE_LIMITED", "AI_OUTPUT_INCOMPLETE", "AI_OUTPUT_INVALID"])("offers retry for %s failures", async (errorCode) => {
  mockRun({ status: "failed", error_code: errorCode, error_message: "provider raw response" });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => run({ status: "queued" }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<RunProgress runId="run-1" />);

  fireEvent.click(screen.getByRole("button", { name: "Retry this stage" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());

  expect(fetchMock).toHaveBeenCalledWith("/api/creation-runs/run-1", { method: "PATCH" });
  expect(screen.queryByText("provider raw response")).not.toBeInTheDocument();
});

it("keeps identical status announcements unchanged across identical data", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-25T05:04:00Z"));
  mockRun();
  const view = render(<RunProgress runId="run-1" />);
  const announcement = screen.getByRole("status").textContent;

  mockRun();
  view.rerender(<RunProgress runId="run-1" />);

  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status").textContent).toBe(announcement);
});

it("renders saved idea choices while waiting", () => {
  mockRun({
    status: "waiting_for_user",
    stage: "idea",
    stages: { idea: { ideas: [{ id: "idea-1", title: "Small tools, durable lessons", angle: "Maintenance compounds", whyNow: "Teams are learning", pillar: "Building", sourceUrls: [] }] } },
  });
  render(<RunProgress runId="run-1" />);

  expect(screen.getByRole("heading", { name: "Choose an idea" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Choose this idea" })).toBeEnabled();
});

it("links a completed run to its draft", () => {
  mockRun({ status: "complete", stage: "ready", draft_id: "draft-7" });
  render(<RunProgress runId="run-1" />);

  expect(screen.getByRole("link", { name: "Review your draft" })).toHaveAttribute("href", "/posts/draft-7");
});
