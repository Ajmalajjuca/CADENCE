"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Callout } from "../../components/ui";
import { InterviewShell } from "./interview-shell";
import { InterviewStepPanel } from "./interview-steps";
import type { InterviewStep, ProfileFormState } from "./profile-form-model";
import { useProfileInterview } from "./use-profile-interview";

function validationMessage(form: ProfileFormState, step: InterviewStep): string {
  if (step === 1 && (!form.name.trim() || !form.work.trim())) return "Add your name and what you do before continuing.";
  if (step === 2 && (!form.audience.trim() || !form.goal.trim())) return "Choose an audience and tell us what your posts should achieve.";
  if (step === 3 && form.pillars.filter((pillar) => pillar.trim()).length === 0) return "Add at least one content topic before continuing.";
  return "";
}

function optionalSectionHasContent(form: ProfileFormState, step: InterviewStep): boolean {
  if (step === 4) return form.samples.some((sample) => sample.trim()) || form.voiceTraits.some((trait) => trait.trim());
  if (step === 5) return [form.lengthPreference, form.casing, form.hashtags, form.emoji, form.cta, form.notes, ...form.bannedTerms].some((value) => value.trim());
  if (step === 6) return form.stories.some((story) => story.title.trim() || story.details.trim() || story.usageNote.trim());
  return false;
}

export function OnboardingForm({
  edit = false,
  initialStep,
  onDone,
  onCancel,
  onSavingChange,
}: {
  edit?: boolean;
  initialStep?: InterviewStep;
  onDone?: () => void;
  onCancel?: () => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const router = useRouter();
  const interview = useProfileInterview({ edit, initialStep });
  const [validationError, setValidationError] = useState("");
  const [confirmSkip, setConfirmSkip] = useState(false);

  useEffect(() => {
    onSavingChange?.(interview.saving);
  }, [interview.saving, onSavingChange]);

  async function finish(saved: boolean, savedStep: InterviewStep) {
    if (!saved) return;
    setValidationError("");
    if (edit) onDone?.();
    else if (savedStep === 6) router.push("/create");
  }

  async function continueInterview() {
    const error = validationMessage(interview.form, interview.step);
    if (error) { setValidationError(error); return; }
    const savedStep = interview.step;
    await finish(await interview.saveAndContinue(), savedStep);
  }

  async function skip() {
    if (optionalSectionHasContent(interview.form, interview.step)) {
      setConfirmSkip(true);
      return;
    }
    const savedStep = interview.step;
    await finish(await interview.skipAndContinue(), savedStep);
  }

  async function discardAndSkip() {
    setConfirmSkip(false);
    const savedStep = interview.step;
    await finish(await interview.skipAndContinue(), savedStep);
  }

  if (!interview.loaded) return <main className="page-container page-container-narrow">
    <div className="mb-6 h-5 w-40 animate-pulse rounded bg-[var(--surface-muted)]" />
    <div className="surface-card min-h-96 animate-pulse p-8" aria-label="Loading voice interview">
      <p role="status" className="text-[var(--muted)]">Loading your saved answers…</p>
    </div>
  </main>;

  if (interview.error === "Could not load your saved answers. Try reloading.") return <main className="page-container page-container-narrow">
    <Callout tone="danger">
      <h1 className="text-2xl font-semibold">Could not load your voice profile</h1>
      <p className="mt-2">Your saved answers have not been changed.</p>
      <Button className="mt-4" onClick={() => window.location.reload()}>Reload page</Button>
    </Callout>
  </main>;

  return <InterviewShell
    step={interview.step}
    saving={interview.saving}
    saveState={interview.saveState}
    error={validationError || interview.error}
    edit={edit}
    onContinue={() => void continueInterview()}
    onBack={() => { setValidationError(""); interview.goBack(); }}
    onSkip={interview.step >= 4 ? () => void skip() : undefined}
    onCancel={onCancel}
  >
    <InterviewStepPanel step={interview.step} form={interview.form} update={interview.update} />
    {confirmSkip && <div role="alertdialog" aria-labelledby="discard-title" aria-describedby="discard-description" className="callout" data-tone="waiting">
      <h2 id="discard-title" className="text-lg font-semibold">Discard this section?</h2>
      <p id="discard-description" className="mt-2 text-sm">Skipping will clear the answers currently typed in this section.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={interview.saving} onClick={() => setConfirmSkip(false)}>Keep editing</Button>
        <Button variant="danger" disabled={interview.saving} onClick={() => void discardAndSkip()}>Discard and skip</Button>
      </div>
    </div>}
  </InterviewShell>;
}
