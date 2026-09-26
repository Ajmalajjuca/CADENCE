// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OnboardingForm } from "./onboarding-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function profileAt(step: number) {
  return {
    profile: {
      name: "Ajmal",
      work: "Founder",
      location: "",
      audience: "Founders",
      goal: "Build trust",
      voice_traits: [],
      onboarding_step: step,
    },
    pillars: [{ name: "AI" }, { name: "Building" }],
    rules: null,
    samples: [],
    stories: [],
  };
}

function mockProfile(step: number, patchResponse: Promise<unknown> | null = null) {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => profileAt(step) });
  if (patchResponse) fetchMock.mockImplementationOnce(() => patchResponse);
  else fetchMock.mockResolvedValue({ ok: true, json: async () => profileAt(Math.min(6, step + 1)) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows focused progress, one heading, and accessible choices", async () => {
  mockProfile(1);
  render(<OnboardingForm />);

  expect(await screen.findByText("Step 2 of 6")).toBeVisible();
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Who do you want your posts to reach?" })).toBeVisible();
  const founders = screen.getByRole("button", { name: "Founders" });
  expect(founders).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Product leaders" }));
  expect(screen.getByLabelText("Audience")).toHaveValue("Product leaders");
  expect(screen.getByRole("progressbar", { name: "Profile setup progress" })).toHaveAttribute("aria-valuenow", "2");
});

it("shows inline validation before saving required essentials", async () => {
  const fetchMock = mockProfile(0);
  render(<OnboardingForm />);
  await screen.findByRole("heading", { name: "What should we call you?" });
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Add your name and what you do");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("preserves the visible pillar order when moving and removing topics", async () => {
  const fetchMock = mockProfile(2);
  render(<OnboardingForm />);
  await screen.findByRole("heading", { name: "What topics do you want to be known for?" });

  fireEvent.click(screen.getByRole("button", { name: "Move Building up" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove AI" }));
  fireEvent.change(screen.getByLabelText("Add a content topic"), { target: { value: "Leadership" } });
  fireEvent.click(screen.getByRole("button", { name: "Add topic" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ step: 3, pillars: ["Building", "Leadership"] });
});

it("confirms before skipping typed optional content", async () => {
  const fetchMock = mockProfile(3);
  render(<OnboardingForm />);
  const sample = await screen.findByLabelText("Writing sample 1");
  fireEvent.change(sample, { target: { value: "Keep this draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

  expect(screen.getByRole("group", { name: "Discard this section?" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Writing sample 1")).toHaveValue("Keep this draft");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([
  ["Story 1 title", "Launch"],
  ["Story 1 usage note", "Use for lessons"],
])("does not discard a partial story entered in %s", async (label, value) => {
  const fetchMock = mockProfile(5);
  render(<OnboardingForm />);
  fireEvent.change(await screen.findByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

  expect(screen.getByRole("alert")).toHaveTextContent("Add the details for every story");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(push).not.toHaveBeenCalled();
});

it("explicitly skips stories and finishes setup", async () => {
  const fetchMock = mockProfile(5);
  render(<OnboardingForm />);
  expect(await screen.findByText("Cadence may use only the details you add here. It will never invent personal experiences.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

  await waitFor(() => expect(push).toHaveBeenCalledWith("/create"));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ step: 6, stories: [] });
});

it("supports up to five exact writing samples and selectable voice traits", async () => {
  mockProfile(3);
  render(<OnboardingForm />);
  const first = await screen.findByLabelText("Writing sample 1");
  fireEvent.change(first, { target: { value: "Line one\n\nLine two" } });
  fireEvent.click(screen.getByRole("button", { name: "Direct" }));
  for (let index = 0; index < 4; index += 1) fireEvent.click(screen.getByRole("button", { name: "Add another sample" }));
  expect(screen.getByLabelText("Writing sample 5")).toBeVisible();
  expect(screen.getByRole("button", { name: "Add another sample" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Direct" })).toHaveAttribute("aria-pressed", "true");
});
