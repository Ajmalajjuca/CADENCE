"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button, Callout, Field, linkButtonClass, StatusBadge } from "../../components/ui";

type ModelOption = {
  id: string;
  label: string;
  description: string;
  roles: Array<"research" | "writing">;
  recommended: boolean;
};

type AiSettings = {
  status: "not_configured" | "valid" | "invalid" | "unchecked";
  keySuffix?: string;
  researchModel?: string;
  writingModel?: string;
  validatedAt?: string;
};

type LinkedInConnection = {
  status: "disconnected" | "connected" | "expired" | "revoked";
  expiresAt?: string;
};

const SAFE_ERRORS: Record<string, string> = {
  AI_SETTINGS_INVALID: "Anthropic rejected this API key. Check it and try again.",
  AI_SETTINGS_REQUIRED: "Enter an Anthropic API key to finish setting up Claude.",
  AI_SETTINGS_INVALID_INPUT: "Check the API key and model selections.",
  AI_MODEL_NOT_ALLOWED: "Select a supported model for both research and writing.",
  AI_MODEL_UNAVAILABLE: "Your Anthropic account cannot use one of these models.",
  AI_RATE_LIMITED: "Too many validation attempts. Wait one minute and try again.",
  AI_PROVIDER_UNAVAILABLE: "Anthropic could not validate these settings. Try again shortly.",
  AI_CREDIT_REQUIRED: "Your Anthropic account needs available API credits.",
  AI_SETTINGS_IN_USE: "Finish active creation runs before removing these settings.",
  AI_SETTINGS_CHANGED: "Your Claude settings changed in another request. Review them and try again.",
};

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { code?: string };
  if (!response.ok) throw new Error(SAFE_ERRORS[body.code ?? ""] ?? "Could not save your Claude settings. Try again.");
  return body;
}

export function SettingsPage() {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [linkedin, setLinkedin] = useState<LinkedInConnection | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [researchModel, setResearchModel] = useState("");
  const [writingModel, setWritingModel] = useState("");
  const [editMode, setEditMode] = useState<"models" | "key" | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingError, setLoadingError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const modelsRequest = fetch("/api/settings/ai/models");
    const settingsRequest = fetch("/api/settings/ai", { cache: "no-store" });
    const linkedinRequest = fetch("/api/linkedin/status", { cache: "no-store" });
    Promise.all([modelsRequest, settingsRequest, linkedinRequest])
      .then(async ([modelResponse, settingsResponse, linkedinResponse]) => {
        if (!modelResponse.ok || !settingsResponse.ok || !linkedinResponse.ok) throw new Error();
        const [{ models: available }, saved, connection] = await Promise.all([
          modelResponse.json() as Promise<{ models: ModelOption[] }>,
          settingsResponse.json() as Promise<AiSettings>,
          linkedinResponse.json() as Promise<LinkedInConnection>,
        ]);
        if (!active) return;
        const fallback = available.find((model) => model.recommended)?.id ?? available[0]?.id ?? "";
        setModels(available);
        setSettings(saved);
        setLinkedin(connection);
        setResearchModel(saved.researchModel ?? fallback);
        setWritingModel(saved.writingModel ?? fallback);
        setEditMode(saved.status === "not_configured" ? "key" : null);
      })
      .catch(() => { if (active) setLoadingError("Could not load settings. Refresh and try again."); });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload: { apiKey?: string; researchModel: string; writingModel: string } = { researchModel, writingModel };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      const saved = await readJson<AiSettings>(await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }));
      setSettings(saved);
      setApiKey("");
      setEditMode(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your Claude settings. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove your saved Anthropic API key from Cadence?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/settings/ai", { method: "DELETE" });
      if (!response.ok) await readJson(response);
      setSettings({ status: "not_configured" });
      setApiKey("");
      setEditMode("key");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove your Claude settings.");
    } finally {
      setBusy(false);
    }
  }

  const configured = settings && settings.status !== "not_configured";
  const availableFor = (role: "research" | "writing") => models.filter((model) => model.roles.includes(role));

  return <main className="page-container page-container-narrow">
    <header className="page-heading">
      <p className="eyebrow">Account</p>
      <h1 className="display-heading">Settings</h1>
      <p className="page-intro">Manage the services Cadence uses for your content and publishing.</p>
    </header>
    {loadingError && <Callout tone="danger" className="mt-6">{loadingError}</Callout>}

    <section className="surface-card mt-8 p-6 sm:p-8" aria-labelledby="claude-settings">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="claude-settings" className="text-2xl font-semibold">Claude AI</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Use your own Anthropic API key for research and writing.</p>
        </div>
        {settings && <StatusBadge tone={settings.status === "valid" ? "success" : "waiting"}>
          {settings.status === "valid" ? "Configured" : settings.status === "not_configured" ? "Setup required" : "Revalidation required"}
        </StatusBadge>}
      </div>

      {!settings && !loadingError && <p role="status" className="mt-5 text-[var(--muted)]">Loading Claude settings…</p>}

      {configured && !editMode && <div className="mt-6">
        <dl className="grid gap-5 sm:grid-cols-2">
          <div><dt className="text-sm text-[var(--muted)]">Saved API key</dt><dd className="mt-1 font-semibold">•••• {settings.keySuffix}</dd></div>
          <div><dt className="text-sm text-[var(--muted)]">Research model</dt><dd className="mt-1 font-semibold">{models.find((model) => model.id === settings.researchModel)?.label ?? settings.researchModel}</dd></div>
          <div><dt className="text-sm text-[var(--muted)]">Writing model</dt><dd className="mt-1 font-semibold">{models.find((model) => model.id === settings.writingModel)?.label ?? settings.writingModel}</dd></div>
          {settings.validatedAt && <div><dt className="text-sm text-[var(--muted)]">Last validated</dt><dd className="mt-1 font-semibold">{new Date(settings.validatedAt).toLocaleString()}</dd></div>}
        </dl>
        {settings.status !== "valid" && <Callout tone="waiting" className="mt-4">Your key needs to be validated again before creating content.</Callout>}
        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setEditMode("models")}>Change models</Button>
          <Button variant="secondary" onClick={() => setEditMode("key")}>Replace key</Button>
          <Button variant="quiet" disabled={busy} onClick={() => void remove()} className="text-[var(--danger)]">Remove key</Button>
        </div>
      </div>}

      {settings && (!configured || editMode) && <form onSubmit={save} className="mt-6 space-y-5">
        {editMode === "key" && <Field label="Anthropic API key" htmlFor="anthropic-key" hint="Cadence encrypts the key before storing it. The full key is never shown again.">
          <input id="anthropic-key" aria-label="Anthropic API key" type="password" autoComplete="off" value={apiKey} required onChange={(event) => setApiKey(event.target.value)} placeholder="sk-ant-…" />
        </Field>}
        <Field label="Research model" htmlFor="research-model">
          <select id="research-model" aria-label="Research model" value={researchModel} onChange={(event) => setResearchModel(event.target.value)}>
            {availableFor("research").map((model) => <option key={model.id} value={model.id}>{model.label}{model.recommended ? " — Recommended" : ""}</option>)}
          </select>
        </Field>
        <Field label="Writing model" htmlFor="writing-model">
          <select id="writing-model" aria-label="Writing model" value={writingModel} onChange={(event) => setWritingModel(event.target.value)}>
            {availableFor("writing").map((model) => <option key={model.id} value={model.id}>{model.label}{model.recommended ? " — Recommended" : ""}</option>)}
          </select>
        </Field>
        <p className="text-sm text-[var(--muted)]">Saving validates your key and access to both selected models without generating content.</p>
        {error && <Callout tone="danger">{error}</Callout>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy || !researchModel || !writingModel}>{busy ? "Validating…" : "Validate and save"}</Button>
          {configured && <Button variant="secondary" disabled={busy} onClick={() => { setEditMode(null); setApiKey(""); setError(""); }}>Cancel</Button>}
        </div>
      </form>}
    </section>

    <section className="surface-card mt-6 p-6 sm:p-8" aria-labelledby="linkedin-settings">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="linkedin-settings" className="text-2xl font-semibold">LinkedIn</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Connect your own LinkedIn account through Cadence’s central application.</p>
        </div>
        {linkedin && <StatusBadge tone={linkedin.status === "connected" ? "success" : "neutral"}>{linkedin.status === "connected" ? "Connected" : "Not connected"}</StatusBadge>}
      </div>
      {!linkedin && !loadingError && <p role="status" className="mt-5 text-[var(--muted)]">Loading LinkedIn status…</p>}
      {linkedin?.expiresAt && <p className="mt-4 text-sm text-[var(--muted)]">Access expires {new Date(linkedin.expiresAt).toLocaleDateString()}.</p>}
      <a href="/api/linkedin/connect" className={linkButtonClass.primary + " mt-5"}>{linkedin?.status === "connected" ? "Reconnect LinkedIn" : "Connect LinkedIn"}</a>
      <p className="mt-4 text-sm leading-6 text-[var(--muted)]">Cadence publishes only after you approve an exact draft version and click Publish now.</p>
    </section>
  </main>;
}
