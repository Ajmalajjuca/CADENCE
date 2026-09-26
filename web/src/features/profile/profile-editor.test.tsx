// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProfileEditor } from "./profile-editor";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const fixture = {
  profile: {
    name: "Ajmal",
    work: "Founder",
    location: "India",
    audience: "AI founders",
    goal: "Build trust",
    voice_traits: ["Direct"],
    onboarding_step: 6,
  },
  pillars: [{ name: "AI" }, { name: "Building" }, { name: "Leadership" }],
  samples: [{ text: "A sample" }],
  rules: null,
  stories: [],
};

function response(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("summarizes sections and edits only the selected section", async () => {
  const fetchMock = vi.fn().mockResolvedValue(response(fixture));
  vi.stubGlobal("fetch", fetchMock);
  render(<ProfileEditor />);

  expect(await screen.findByRole("heading", { name: "Your voice profile" })).toBeVisible();
  expect(screen.getByText("3 content topics")).toBeVisible();
  expect(screen.getAllByText("Not added yet")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Edit Content topics" }));

  expect(await screen.findByRole("heading", { name: "What topics do you want to be known for?" })).toBeVisible();
  expect(screen.queryByText("Step 1 of 6")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Your voice profile" })).not.toBeInTheDocument();
});

it("cancels a focused edit and returns to the overview", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(fixture)));
  render(<ProfileEditor />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Real stories" }));
  await screen.findByRole("heading", { name: "Which real experiences may Cadence draw from?" });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(await screen.findByRole("heading", { name: "Your voice profile" })).toBeVisible();
});

it("refreshes summaries after saving one section", async () => {
  const updated = { ...fixture, pillars: [{ name: "AI systems" }] };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(fixture))
    .mockResolvedValueOnce(response(fixture))
    .mockResolvedValueOnce(response(updated))
    .mockResolvedValueOnce(response(updated))
    .mockResolvedValue(response(updated));
  vi.stubGlobal("fetch", fetchMock);
  render(<ProfileEditor />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Content topics" }));
  await screen.findByRole("heading", { name: "What topics do you want to be known for?" });
  fireEvent.click(screen.getByRole("button", { name: "Save section" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Your voice profile" })).toBeVisible());
  expect(screen.getByText("1 content topic")).toBeVisible();
  for (const edit of screen.getAllByRole("button", { name: /^Edit / })) expect(edit).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Edit Real stories" }));
  expect(await screen.findByRole("heading", { name: "Which real experiences may Cadence draw from?" })).toBeVisible();
});

it("disables cancel while a section save is in flight", async () => {
  let resolvePatch!: (value: Response) => void;
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(fixture))
    .mockResolvedValueOnce(response(fixture))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolvePatch = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  render(<ProfileEditor />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Content topics" }));
  await screen.findByRole("heading", { name: "What topics do you want to be known for?" });
  fireEvent.click(screen.getByRole("button", { name: "Save section" }));
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  resolvePatch(response(fixture));
});
