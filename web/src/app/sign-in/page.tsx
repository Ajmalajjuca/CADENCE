"use client";

import { useState, type FormEvent } from "react";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/sign-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      setMessage(response.ok
        ? "Check your email for a sign-in link."
        : result?.error ?? "We could not send a link. Check your invitation and try again.");
    } catch { setMessage("Connection failed. Please try again."); }
    finally { setLoading(false); }
  }

  return <main className="mx-auto max-w-md px-6 py-20">
    <h1 className="text-3xl font-semibold">Sign in to Cadence</h1>
    <p className="mt-3 text-slate-600">Use the email address that received your invitation.</p>
    <form onSubmit={submit} className="mt-8 space-y-4">
      <label className="block text-sm font-medium" htmlFor="email">Email address</label>
      <input id="email" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="w-full rounded-lg border p-3" />
      <button disabled={loading} className="rounded-lg bg-slate-900 px-5 py-3 text-white disabled:opacity-50">{loading ? "Sending…" : "Send sign-in link"}</button>
    </form>
    <p role="status" className="mt-5">{message}</p>
  </main>;
}
