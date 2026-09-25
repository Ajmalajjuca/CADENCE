// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreateEntry } from "./create-entry";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); push.mockReset(); });

function configured(...responses: Array<Record<string, unknown>>) {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ status: "valid" }) });
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("starts a quick surprise post without asking for a prompt", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "valid" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "run-1" }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<CreateEntry />);
  fireEvent.click(await screen.findByRole("button", { name: "Surprise me" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/create/run-1"));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ entry: "surprise", mode: "quick" });
});

it("requires Claude setup before showing creation actions", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "not_configured" }) }));
  render(<CreateEntry />);
  expect(await screen.findByText("Claude setup required")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "/settings");
  expect(screen.queryByRole("button", { name: "Surprise me" })).not.toBeInTheDocument();
});

it("presents each starting point as a named semantic region", async () => {
  configured();
  render(<CreateEntry />);

  expect(await screen.findByRole("region", { name: "I have a topic" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Find ideas" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Surprise me" })).toBeInTheDocument();
});

it("explains the difference between Quick and Guided modes", async () => {
  configured();
  render(<CreateEntry />);

  expect(await screen.findByText("Quick")).toBeInTheDocument();
  expect(screen.getByText(/Cadence chooses the idea and hook/i)).toBeInTheDocument();
  expect(screen.getByText("Guided")).toBeInTheDocument();
  expect(screen.getByText(/You choose the idea and opening line/i)).toBeInTheDocument();
});

it("shows specific busy copy and disables every direct start action", async () => {
  const pending = new Promise(() => undefined);
  configured(pending as never);
  render(<CreateEntry />);

  fireEvent.click(await screen.findByRole("button", { name: "Find ideas" }));

  expect(screen.getByRole("button", { name: "Finding ideas…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Surprise me" })).toBeDisabled();
});

it("does not expose an unexpected API error message", async () => {
  configured({ ok: false, status: 500, json: async () => ({ error: "postgres://secret@internal-host/database" }) });
  render(<CreateEntry />);

  fireEvent.click(await screen.findByRole("button", { name: "Find ideas" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not start your post. Your details are still here—try again.");
  expect(screen.getByRole("alert")).not.toHaveTextContent("internal-host");
});
