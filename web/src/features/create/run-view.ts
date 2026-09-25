import type { CreationRunJson, RunStage } from "../../server/db/types";

export const POST_STEPS = [
  { stage: "idea", label: "Find an idea" },
  { stage: "research", label: "Research the angle" },
  { stage: "hooks", label: "Create hooks" },
  { stage: "draft", label: "Write the draft" },
  { stage: "style", label: "Polish your voice" },
] as const;

const REVISION_STEPS = [{ stage: "revision", label: "Revise your draft" }] as const;

export type RunStep = {
  stage: RunStage;
  label: string;
  state: "complete" | "active" | "upcoming";
};

export type RunAction =
  | { kind: "wake" }
  | { kind: "retry" }
  | { kind: "settings" }
  | { kind: "review"; draftId: string };

export type RunView = {
  title: string;
  description: string;
  tone: "neutral" | "progress" | "waiting" | "success" | "danger";
  activeStage: RunStage | null;
  steps: RunStep[];
  action: RunAction | null;
};

type ViewCopy = Pick<RunView, "title" | "description" | "tone" | "action">;

const RUNNING_COPY: Record<RunStage, Pick<RunView, "title" | "description">> = {
  idea: { title: "Finding an idea", description: "Cadence is looking for a strong angle for your audience." },
  research: { title: "Researching the angle", description: "Cadence is gathering useful context for your post." },
  hooks: { title: "Creating hooks", description: "Cadence is drafting opening lines that earn attention." },
  draft: { title: "Writing your draft", description: "Cadence is turning the selected angle into a complete post." },
  style: { title: "Polishing your voice", description: "Cadence is applying your voice and content preferences." },
  revision: { title: "Revising your draft", description: "Cadence is applying your requested changes." },
  ready: { title: "Finishing your draft", description: "Cadence is saving the final result." },
};

const FAILURE_COPY: Record<string, ViewCopy> = {
  AI_SETTINGS_REQUIRED: {
    title: "Connect Claude to continue",
    description: "Add your Anthropic API key in Settings, then return to this saved run.",
    tone: "danger",
    action: { kind: "settings" },
  },
  AI_SETTINGS_INVALID: {
    title: "Your Claude key needs attention",
    description: "Update or validate your Anthropic API key in Settings. Your progress is saved.",
    tone: "danger",
    action: { kind: "settings" },
  },
  AI_MODEL_UNAVAILABLE: {
    title: "Choose an available Claude model",
    description: "Open Settings to select a supported model, then retry this saved stage.",
    tone: "danger",
    action: { kind: "settings" },
  },
  AI_CREDIT_REQUIRED: {
    title: "Claude needs more credit",
    description: "Check your Anthropic account and AI Settings before continuing this saved run.",
    tone: "danger",
    action: { kind: "settings" },
  },
  AI_RATE_LIMITED: {
    title: "Claude is busy right now",
    description: "Wait a moment, then retry this stage. Your earlier work is saved.",
    tone: "danger",
    action: { kind: "retry" },
  },
  AI_PROVIDER_UNAVAILABLE: {
    title: "Claude is temporarily unavailable",
    description: "The provider could not complete this stage. Try again shortly.",
    tone: "danger",
    action: { kind: "retry" },
  },
  AI_OUTPUT_INCOMPLETE: {
    title: "Claude stopped before finishing",
    description: "The response ended early. Retry this stage without losing earlier progress.",
    tone: "danger",
    action: { kind: "retry" },
  },
  AI_OUTPUT_INVALID: {
    title: "Claude returned an unusable result",
    description: "Cadence could not safely use that response. Retry this saved stage.",
    tone: "danger",
    action: { kind: "retry" },
  },
};

const GENERIC_FAILURE: ViewCopy = {
  title: "We could not finish this stage",
  description: "Your earlier choices and completed work are saved. Try this stage again.",
  tone: "danger",
  action: { kind: "retry" },
};

function getSteps(run: CreationRunJson, activeStage: RunStage | null): RunStep[] {
  const metadata = run.kind === "revision" ? REVISION_STEPS : POST_STEPS;
  const activeIndex = activeStage ? metadata.findIndex((step) => step.stage === activeStage) : -1;
  return metadata.map((step, index) => ({
    ...step,
    state: run.status === "complete" || activeStage === "ready" || (activeIndex >= 0 && index < activeIndex)
      ? "complete"
      : index === activeIndex
        ? "active"
        : "upcoming",
  }));
}

function queuedCopy(run: CreationRunJson, nowMs: number): ViewCopy {
  const updatedMs = Date.parse(run.updated_at);
  const age = Number.isFinite(updatedMs) ? Math.max(0, nowMs - updatedMs) : 0;

  if (age < 10_000) {
    return {
      title: "Preparing your run",
      description: "Your request is saved. Cadence is getting everything ready.",
      tone: "progress",
      action: null,
    };
  }
  if (age <= 90_000) {
    return {
      title: "Worker is waking up",
      description: "This usually takes 30–90 seconds. You can leave this page—your progress is saved.",
      tone: "waiting",
      action: null,
    };
  }
  return {
    title: "This is taking longer than expected",
    description: "Your run is still saved. Ask Cadence to wake the worker and check again.",
    tone: "waiting",
    action: { kind: "wake" },
  };
}

export function deriveRunView(run: CreationRunJson, nowMs: number): RunView {
  const activeStage = run.status === "complete" ? null : run.stage;
  let copy: ViewCopy;

  switch (run.status) {
    case "queued":
      copy = queuedCopy(run, nowMs);
      break;
    case "running": {
      const running = RUNNING_COPY[run.stage] ?? RUNNING_COPY.idea;
      copy = {
        ...running,
        description: `${running.description} You can leave this page—your progress is saved.`,
        tone: "progress",
        action: null,
      };
      break;
    }
    case "waiting_for_user":
      copy = run.stage === "idea"
        ? { title: "Choose an idea", description: "Pick the angle you want Cadence to develop.", tone: "waiting", action: null }
        : run.stage === "hooks"
          ? { title: "Choose a hook", description: "Pick the opening line that sounds most like you.", tone: "waiting", action: null }
          : { title: "Your input is needed", description: "Choose an option to continue this saved run.", tone: "waiting", action: null };
      break;
    case "failed":
      copy = (run.error_code && FAILURE_COPY[run.error_code]) || GENERIC_FAILURE;
      break;
    case "complete":
      copy = {
        title: run.kind === "revision" ? "Your revision is ready" : "Your draft is ready",
        description: "Cadence saved the finished draft for your review.",
        tone: "success",
        action: run.draft_id ? { kind: "review", draftId: run.draft_id } : null,
      };
      break;
    default:
      copy = {
        title: "Checking your run",
        description: "Your progress is saved while Cadence checks the latest status.",
        tone: "neutral",
        action: null,
      };
  }

  return { ...copy, activeStage, steps: getSteps(run, activeStage) };
}
