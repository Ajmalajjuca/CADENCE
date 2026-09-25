import type { FormEvent, ReactNode } from "react";
import { Button, Callout, StatusBadge } from "../../components/ui";
import { INTERVIEW_SECTIONS } from "./interview-options";
import type { InterviewStep } from "./profile-form-model";

export function InterviewShell({
  step, saving, saveState, error, edit, children, onContinue, onBack, onSkip, onCancel,
}: {
  step: InterviewStep;
  saving: boolean;
  saveState: "idle" | "saving" | "saved";
  error: string;
  edit: boolean;
  children: ReactNode;
  onContinue: () => void;
  onBack: () => void;
  onSkip?: () => void;
  onCancel?: () => void;
}) {
  const section = INTERVIEW_SECTIONS[step - 1];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onContinue();
  }

  return <main className="page-container page-container-narrow">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="eyebrow">{section.label}{section.optional ? " · Optional" : ""}</p>
        {!edit && <p className="mt-1 text-sm font-semibold text-[var(--muted)]">Step {step} of 6</p>}
      </div>
      <StatusBadge tone={saveState === "saved" ? "success" : saveState === "saving" ? "progress" : "neutral"} role="status">
        {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Progress saves by section"}
      </StatusBadge>
    </div>
    {!edit && <div role="progressbar" aria-label="Profile setup progress" aria-valuemin={1} aria-valuemax={6} aria-valuenow={step} className="mb-7 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
      <div className="h-full rounded-full bg-[var(--accent)] transition-[width] motion-reduce:transition-none" style={{ width: `${(step / 6) * 100}%` }} />
    </div>}
    <form onSubmit={submit} className="surface-card overflow-hidden">
      <div className="space-y-6 p-6 sm:p-8">{children}</div>
      {error && <Callout tone="danger" className="mx-6 mb-2 sm:mx-8">{error}</Callout>}
      <div className="flex flex-col-reverse gap-3 border-t border-[var(--border)] bg-[var(--surface-muted)] p-5 sm:flex-row sm:flex-wrap sm:items-center sm:p-6">
        {!edit && step > 1 && <Button variant="quiet" disabled={saving} onClick={onBack}>Back</Button>}
        {edit && onCancel && <Button variant="quiet" disabled={saving} onClick={onCancel}>Cancel</Button>}
        <div className="flex-1" />
        {onSkip && <Button variant="secondary" disabled={saving} onClick={onSkip}>Skip for now</Button>}
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : edit ? "Save section" : step === 6 ? "Finish setup" : "Continue"}</Button>
      </div>
    </form>
  </main>;
}
