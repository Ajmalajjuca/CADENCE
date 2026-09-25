// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsPage } from "./settings-page";

const models = { models: [
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", description: "Fast, balanced quality and cost", roles: ["research","writing"], recommended: true },
  { id: "claude-opus-5", label: "Claude Opus 5", description: "Higher quality with higher cost", roles: ["research","writing"], recommended: false },
] };

function response(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("lets an unconfigured user validate and save a key with separate models", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(models))
    .mockResolvedValueOnce(response({ status: "not_configured" }))
    .mockResolvedValueOnce(response({ status: "disconnected" }))
    .mockResolvedValueOnce(response({ status: "valid", keySuffix: "1234", researchModel: "claude-sonnet-5", writingModel: "claude-opus-5", validatedAt: "2026-09-21T00:00:00.000Z" }));
  vi.stubGlobal("fetch", fetchMock);
  render(<SettingsPage />);
  const key = await screen.findByLabelText("Anthropic API key");
  expect(key).toHaveAttribute("type", "password");
  fireEvent.change(key, { target: { value: "sk-ant-test-1234" } });
  fireEvent.change(screen.getByLabelText("Writing model"), { target: { value: "claude-opus-5" } });
  fireEvent.click(screen.getByRole("button", { name: "Validate and save" }));
  await screen.findByText("Configured");
  const request = fetchMock.mock.calls[3][1];
  expect(JSON.parse(request.body)).toEqual({ apiKey: "sk-ant-test-1234", researchModel: "claude-sonnet-5", writingModel: "claude-opus-5" });
});

it("shows only the saved key suffix and central LinkedIn connection", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(response(models))
    .mockResolvedValueOnce(response({ status: "valid", keySuffix: "9876", researchModel: "claude-sonnet-5", writingModel: "claude-opus-5", validatedAt: "2026-09-21T00:00:00.000Z" }))
    .mockResolvedValueOnce(response({ status: "connected", expiresAt: "2026-10-21T00:00:00.000Z" })));
  render(<SettingsPage />);
  expect(await screen.findByText("•••• 9876")).toBeInTheDocument();
  expect(screen.queryByDisplayValue(/sk-ant/)).not.toBeInTheDocument();
  expect(screen.getByText("Connected")).toBeInTheDocument();
  expect(screen.getByText(/Last validated/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Change models" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Replace key" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Reconnect LinkedIn" })).toHaveAttribute("href", "/api/linkedin/connect");
});

it("shows a safe validation error returned by the API", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(models))
    .mockResolvedValueOnce(response({ status: "not_configured" }))
    .mockResolvedValueOnce(response({ status: "disconnected" }))
    .mockResolvedValueOnce(response({ error: "Your Anthropic API key was rejected.", code: "AI_SETTINGS_INVALID" }, false, 400));
  vi.stubGlobal("fetch", fetchMock);
  render(<SettingsPage />);
  fireEvent.change(await screen.findByLabelText("Anthropic API key"), { target: { value: "sk-ant-invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "Validate and save" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Anthropic rejected this API key"));
  expect(screen.getByRole("alert")).not.toHaveTextContent("sk-ant-invalid");
});

it("keeps settings load failures in an alert", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, false, 500)));
  render(<SettingsPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load settings");
});
