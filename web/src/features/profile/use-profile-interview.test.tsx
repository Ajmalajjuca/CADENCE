// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useProfileInterview } from "./use-profile-interview";

function response(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) } as Response;
}

function completeProfile(step = 1) {
  return {
    profile: {
      name: "Ajmal",
      work: "Founder",
      location: "",
      audience: "Builders",
      goal: "Share lessons",
      voice_traits: [],
      onboarding_step: step,
    },
    pillars: [{ name: "AI" }],
    rules: null,
    samples: [],
    stories: [],
  };
}

function Probe({ edit = false, initialStep }: { edit?: boolean; initialStep?: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const interview = useProfileInterview({ edit, initialStep });
  return <div>
    <p data-testid="loaded">{String(interview.loaded)}</p>
    <p data-testid="step">{interview.step}</p>
    <p data-testid="saving">{String(interview.saving)}</p>
    <p data-testid="save-state">{interview.saveState}</p>
    <p role="alert">{interview.error}</p>
    <label>Audience<input value={interview.form.audience} onChange={(event) => interview.update({ audience: event.target.value })} /></label>
    <button onClick={() => void interview.saveAndContinue()}>Continue</button>
    <button onClick={() => interview.goBack()}>Back</button>
  </div>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("loads an empty profile safely", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ profile: null })));
  render(<Probe />);
  expect(screen.getByTestId("loaded")).toHaveTextContent("false");
  expect(await screen.findByTestId("loaded")).toHaveTextContent("true");
  expect(screen.getByTestId("step")).toHaveTextContent("1");
  expect(screen.getByLabelText("Audience")).toHaveValue("");
});

it("resumes after the last saved step and honors edit-mode section selection", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(completeProfile(3))));
  const first = render(<Probe />);
  await waitFor(() => expect(screen.getByTestId("step")).toHaveTextContent("4"));
  first.unmount();

  render(<Probe edit initialStep={5} />);
  await waitFor(() => expect(screen.getByTestId("step")).toHaveTextContent("5"));
});

it("saves a section and advances only after a successful PATCH", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(completeProfile(1)))
    .mockResolvedValueOnce(response(completeProfile(2)));
  vi.stubGlobal("fetch", fetchMock);
  render(<Probe />);
  await waitFor(() => expect(screen.getByTestId("step")).toHaveTextContent("2"));

  fireEvent.change(screen.getByLabelText("Audience"), { target: { value: "AI founders" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  await waitFor(() => expect(screen.getByTestId("step")).toHaveTextContent("3"));
  expect(fetchMock).toHaveBeenLastCalledWith("/api/profile", expect.objectContaining({
    method: "PATCH",
    body: JSON.stringify({ step: 2, audience: "AI founders", goal: "Share lessons" }),
  }));
  expect(screen.getByTestId("save-state")).toHaveTextContent("saved");
});

it("keeps typed answers and the current step when save fails", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(completeProfile(1)))
    .mockResolvedValueOnce(response({ error: "Please check the required fields" }, false));
  vi.stubGlobal("fetch", fetchMock);
  render(<Probe />);
  await waitFor(() => expect(screen.getByTestId("step")).toHaveTextContent("2"));

  fireEvent.change(screen.getByLabelText("Audience"), { target: { value: "AI founders" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Please check the required fields");
  expect(screen.getByLabelText("Audience")).toHaveValue("AI founders");
  expect(screen.getByTestId("step")).toHaveTextContent("2");
});

it("allows back navigation without saving typed values", async () => {
  const fetchMock = vi.fn().mockResolvedValue(response(completeProfile(2)));
  vi.stubGlobal("fetch", fetchMock);
  render(<Probe />);
  await waitFor(() => expect(screen.getByTestId("step")).toHaveTextContent("3"));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByTestId("step")).toHaveTextContent("2");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("ignores a second save while the first PATCH is pending", async () => {
  let resolvePatch!: (value: Response) => void;
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(completeProfile(1)))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolvePatch = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  render(<Probe />);
  await waitFor(() => expect(screen.getByTestId("step")).toHaveTextContent("2"));

  const continueButton = screen.getByRole("button", { name: "Continue" });
  fireEvent.click(continueButton);
  fireEvent.click(continueButton);
  expect(fetchMock).toHaveBeenCalledTimes(2);

  await act(async () => resolvePatch(response(completeProfile(2))));
});

it("aborts the initial request when unmounted", async () => {
  const requestState: { signal?: AbortSignal } = {};
  vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
    requestState.signal = init?.signal ?? undefined;
    return new Promise(() => undefined);
  }));
  const view = render(<Probe />);
  await act(async () => Promise.resolve());
  expect(requestState.signal?.aborted).toBe(false);
  view.unmount();
  expect(requestState.signal?.aborted).toBe(true);
});
