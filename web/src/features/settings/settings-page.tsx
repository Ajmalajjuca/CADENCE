"use client";

import { FormEvent, useEffect, useState } from "react";

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
        const fallback = available.find(model => model.recommended)?.id ?? available[0]?.id ?? "";
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
  const availableFor = (role: "research" | "writing") => models.filter(model => model.roles.includes(role));

  return <main className="mx-auto max-w-3xl px-6 py-12">
    <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">Account</p>
    <h1 className="mt-2 text-4xl font-semibold">Settings</h1>
    <p className="mt-3 text-slate-600">Manage the services Cadence uses for your content and publishing.</p>
    {loadingError && <p role="alert" className="mt-6 rounded-lg bg-red-50 p-4 text-red-700">{loadingError}</p>}

    <section className="mt-8 rounded-2xl border bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xl font-semibold">Claude AI</h2><p className="mt-1 text-sm text-slate-600">Use your own Anthropic API key for research and writing.</p></div>
        {settings && <span className={`rounded-full px-3 py-1 text-sm font-medium ${settings.status === "valid" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{settings.status === "valid" ? "Configured" : settings.status === "not_configured" ? "Setup required" : "Revalidation required"}</span>}
      </div>

      {!settings && !loadingError && <p role="status" className="mt-5 text-slate-600">Loading Claude settings…</p>}

      {configured && !editMode && <div className="mt-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div><dt className="text-sm text-slate-500">Saved API key</dt><dd className="mt-1 font-medium">•••• {settings.keySuffix}</dd></div>
          <div><dt className="text-sm text-slate-500">Research model</dt><dd className="mt-1 font-medium">{models.find(model => model.id === settings.researchModel)?.label ?? settings.researchModel}</dd></div>
          <div><dt className="text-sm text-slate-500">Writing model</dt><dd className="mt-1 font-medium">{models.find(model => model.id === settings.writingModel)?.label ?? settings.writingModel}</dd></div>
          {settings.validatedAt && <div><dt className="text-sm text-slate-500">Last validated</dt><dd className="mt-1 font-medium">{new Date(settings.validatedAt).toLocaleString()}</dd></div>}
        </dl>
        {settings.status !== "valid" && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Your key needs to be validated again before creating content.</p>}
        <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={() => setEditMode("models")} className="rounded-lg border px-4 py-2">Change models</button><button type="button" onClick={() => setEditMode("key")} className="rounded-lg border px-4 py-2">Replace key</button><button type="button" disabled={busy} onClick={() => void remove()} className="rounded-lg px-4 py-2 text-red-700 disabled:opacity-50">Remove key</button></div>
      </div>}

      {settings && (!configured || editMode) && <form onSubmit={save} className="mt-6 space-y-5">
        {editMode === "key" && <label className="block"><span className="font-medium">Anthropic API key</span><input aria-label="Anthropic API key" type="password" autoComplete="off" value={apiKey} required onChange={event => setApiKey(event.target.value)} placeholder="sk-ant-…" className="mt-2 w-full rounded-lg border px-3 py-3" /><span className="mt-1 block text-xs text-slate-500">Cadence encrypts the key before storing it. The full key is never shown again.</span></label>}
        <label className="block"><span className="font-medium">Research model</span><select aria-label="Research model" value={researchModel} onChange={event => setResearchModel(event.target.value)} className="mt-2 w-full rounded-lg border px-3 py-3">{availableFor("research").map(model => <option key={model.id} value={model.id}>{model.label}{model.recommended ? " — Recommended" : ""}</option>)}</select></label>
        <label className="block"><span className="font-medium">Writing model</span><select aria-label="Writing model" value={writingModel} onChange={event => setWritingModel(event.target.value)} className="mt-2 w-full rounded-lg border px-3 py-3">{availableFor("writing").map(model => <option key={model.id} value={model.id}>{model.label}{model.recommended ? " — Recommended" : ""}</option>)}</select></label>
        <p className="text-sm text-slate-600">Saving validates your key and access to both selected models without generating content.</p>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
        <div className="flex gap-3"><button type="submit" disabled={busy || !researchModel || !writingModel} className="rounded-lg bg-slate-900 px-5 py-3 text-white disabled:opacity-50">{busy ? "Validating…" : "Validate and save"}</button>{configured && <button type="button" disabled={busy} onClick={() => { setEditMode(null); setApiKey(""); setError(""); }} className="rounded-lg border px-5 py-3">Cancel</button>}</div>
      </form>}
    </section>

    <section className="mt-6 rounded-2xl border bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">LinkedIn</h2><p className="mt-1 text-sm text-slate-600">Cadence uses its central LinkedIn application to connect your account.</p></div>{linkedin && <span className={`rounded-full px-3 py-1 text-sm font-medium ${linkedin.status === "connected" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{linkedin.status === "connected" ? "Connected" : "Not connected"}</span>}</div>
      {!linkedin && !loadingError && <p role="status" className="mt-5 text-slate-600">Loading LinkedIn status…</p>}
      {linkedin?.expiresAt && <p className="mt-4 text-sm text-slate-600">Access expires {new Date(linkedin.expiresAt).toLocaleDateString()}.</p>}
      <a href="/api/linkedin/connect" className="mt-5 inline-block rounded-lg bg-slate-900 px-5 py-3 text-white">{linkedin?.status === "connected" ? "Reconnect LinkedIn" : "Connect LinkedIn"}</a>
      <p className="mt-4 text-sm text-slate-600">Cadence publishes only after you approve an exact draft version and click Publish now.</p>
    </section>
  </main>;
}
