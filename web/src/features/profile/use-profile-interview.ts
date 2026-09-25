"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearOptionalSection,
  emptyProfileForm,
  firstIncompleteStep,
  normalizeProfileState,
  payloadForStep,
  type InterviewStep,
  type ProfileFormState,
} from "./profile-form-model";

type SaveState = "idle" | "saving" | "saved";
type FormUpdate = Partial<ProfileFormState> | ((current: ProfileFormState) => ProfileFormState);

export type ProfileInterviewState = {
  form: ProfileFormState;
  step: InterviewStep;
  loaded: boolean;
  saving: boolean;
  saveState: SaveState;
  error: string;
  update: (update: FormUpdate) => void;
  saveAndContinue: () => Promise<boolean>;
  skipAndContinue: () => Promise<boolean>;
  goBack: () => void;
  goToStep: (step: InterviewStep) => void;
};

export function useProfileInterview({
  edit = false,
  initialStep,
}: {
  edit?: boolean;
  initialStep?: InterviewStep;
} = {}): ProfileInterviewState {
  const [form, setForm] = useState<ProfileFormState>(() => ({
    ...emptyProfileForm,
    pillars: [],
    samples: [""],
    voiceTraits: [],
    bannedTerms: [],
    stories: [{ title: "", details: "", usageNote: "" }],
  }));
  const [step, setStep] = useState<InterviewStep>(initialStep ?? 1);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const saveLock = useRef(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    request.current = controller;
    let cancelled = false;

    queueMicrotask(async () => {
      try {
        const response = await fetch("/api/profile", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Profile request failed");
        const data = await response.json();
        if (cancelled || !mounted.current) return;
        setForm(normalizeProfileState(data));
        setStep(edit ? initialStep ?? 1 : firstIncompleteStep(data));
        setError("");
      } catch (caught) {
        if (cancelled || !mounted.current) return;
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError("Could not load your saved answers. Try reloading.");
      } finally {
        if (!cancelled && mounted.current) setLoaded(true);
      }
    });

    return () => {
      cancelled = true;
      mounted.current = false;
      controller.abort();
      request.current?.abort();
      request.current = null;
    };
  }, [edit, initialStep]);

  const update = useCallback((next: FormUpdate) => {
    setForm((current) => typeof next === "function" ? next(current) : { ...current, ...next });
    setSaveState("idle");
    setError("");
  }, []);

  const persist = useCallback(async (target: InterviewStep, nextForm: ProfileFormState) => {
    if (saveLock.current) return false;
    saveLock.current = true;
    setSaving(true);
    setError("");
    setSaveState("saving");
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payloadForStep(nextForm, target)),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save this section.");
      if (!mounted.current) return false;
      setSaveState("saved");
      return true;
    } catch (caught) {
      if (!mounted.current) return false;
      setSaveState("idle");
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(caught instanceof Error ? caught.message : "Could not save this section.");
      }
      return false;
    } finally {
      if (mounted.current) setSaving(false);
      if (request.current === controller) request.current = null;
      saveLock.current = false;
    }
  }, []);

  const saveAndContinue = useCallback(async () => {
    const target = step;
    const saved = await persist(target, form);
    if (saved && !edit && target < 6) setStep((target + 1) as InterviewStep);
    return saved;
  }, [edit, form, persist, step]);

  const skipAndContinue = useCallback(async () => {
    const target = step;
    const cleared = clearOptionalSection(form, target);
    const saved = await persist(target, cleared);
    if (saved) {
      setForm(cleared);
      if (!edit && target < 6) setStep((target + 1) as InterviewStep);
    }
    return saved;
  }, [edit, form, persist, step]);

  const goBack = useCallback(() => {
    if (saving) return;
    setStep((current) => Math.max(1, current - 1) as InterviewStep);
    setError("");
    setSaveState("idle");
  }, [saving]);

  const goToStep = useCallback((nextStep: InterviewStep) => {
    if (saving) return;
    setStep(nextStep);
    setError("");
    setSaveState("idle");
  }, [saving]);

  return {
    form,
    step,
    loaded,
    saving,
    saveState,
    error,
    update,
    saveAndContinue,
    skipAndContinue,
    goBack,
    goToStep,
  };
}
