"use client";

import { useState, type FormEvent } from "react";
import { Button, Callout, Field } from "../../components/ui";

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

  return <main className="page-container page-container-narrow">
    <header className="page-heading">
      <p className="eyebrow">Welcome back</p>
      <h1 className="display-heading">Sign in to Cadence</h1>
      <p className="page-intro">Use the email address that received your invitation.</p>
    </header>
    <form onSubmit={submit} className="surface-card mt-8 space-y-5 p-6 sm:p-8">
      <Field label="Email address" htmlFor="email">
        <input id="email" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} />
      </Field>
      <Button type="submit" disabled={loading}>{loading ? "Sending…" : "Send sign-in link"}</Button>
    </form>
    {message && <Callout role="status" tone="neutral" className="mt-5">{message}</Callout>}
  </main>;
}
