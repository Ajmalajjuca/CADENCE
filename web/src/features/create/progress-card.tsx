import { StatusBadge } from "../../components/ui";
import type { RunView } from "./run-view";

const toneLabels = {
  neutral: "Checking",
  progress: "In progress",
  waiting: "Waiting",
  success: "Ready",
  danger: "Needs attention",
} as const;

const stepSymbols = {
  complete: "✓",
  active: "●",
  upcoming: "○",
} as const;

export function ProgressCard({ view }: { view: RunView }) {
  return <article className="progress-card" data-tone={view.tone}>
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {view.title}
    </p>
    <div className="progress-card-copy">
      <StatusBadge tone={view.tone}>{toneLabels[view.tone]}</StatusBadge>
      <h1 className="progress-title">{view.title}</h1>
      <p className="progress-description">{view.description}</p>
    </div>
    <ol className="progress-steps" aria-label="Creation progress">
      {view.steps.map((step) => <li key={step.stage} className="progress-step">
        <span aria-hidden="true" className="progress-step-symbol">{stepSymbols[step.state]}</span>
        <span data-state={step.state} className="progress-step-label">{step.label}</span>
      </li>)}
    </ol>
  </article>;
}
