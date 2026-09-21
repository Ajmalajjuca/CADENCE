// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DraftEditor } from "./editor";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); push.mockReset(); });

const version = { id: "version-1", version_no: 1, text: "A held view about shipping.", hook: "Hook", source_refs: [], created_at: "2026-09-21T00:00:00.000Z" };
const review = { draft: { id: "draft-1", title: "Shipping", status: "drafted", legacy_post_url: null }, versions: [version], approved: null, attempts: [] };

function loadedDraft(...revisionResponses: Array<Record<string, unknown>>) {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => review })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "connected" }) });
  for (const response of revisionResponses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function requestRevision(direction = "Sharpen the opening") {
  fireEvent.click(await screen.findByRole("button", { name: "Request a revision" }));
  fireEvent.change(screen.getByLabelText("What should change?"), { target: { value: direction } });
  fireEvent.click(screen.getByRole("button", { name: "Create revised version" }));
}

it("sends the owner to Settings when a revision is refused for missing Claude settings", async () => {
  loadedDraft({ ok: false, status: 409, json: async () => ({ error: "Configure Claude in Settings before creating content.", code: "AI_SETTINGS_REQUIRED" }) });
  render(<DraftEditor draftId="draft-1" />);
  await requestRevision();
  expect(await screen.findByText("Configure Claude in Settings before creating content.")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "/settings"));
  expect(push).not.toHaveBeenCalled();
});

it("shows a refused revision's own reason without offering Settings for unrelated failures", async () => {
  loadedDraft({ ok: false, status: 429, json: async () => ({ error: "Daily creation limit reached. Try again tomorrow." }) });
  render(<DraftEditor draftId="draft-1" />);
  await requestRevision();
  expect(await screen.findByText("Daily creation limit reached. Try again tomorrow.")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open Settings" })).not.toBeInTheDocument();
});

it("opens the new run when a revision starts", async () => {
  loadedDraft({ ok: true, status: 200, json: async () => ({ id: "run-9" }) });
  render(<DraftEditor draftId="draft-1" />);
  await requestRevision();
  await waitFor(() => expect(push).toHaveBeenCalledWith("/create/run-9"));
});
