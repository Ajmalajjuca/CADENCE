// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreateEntry } from "./create-entry";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); push.mockReset(); });

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
