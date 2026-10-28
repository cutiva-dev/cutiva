"use client";

import { useState, type FormEvent } from "react";

export function WaitlistForm() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setStatus("Joining…");
    try {
      const res = await fetch(form.action, { method: "POST", body: new FormData(form) });
      const body = (await res.json()) as { ok: boolean; error?: string };
      setStatus(body.ok ? "You're on the list. We'll email you when v0.1 ships." : (body.error ?? "Something went wrong. Try again."));
      if (body.ok) form.reset();
    } catch {
      setStatus("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" method="post" action="/api/waitlist" onSubmit={submit}>
      <label>Get early access to the SDK and the cloud
        <input type="email" name="email" required autoComplete="email" placeholder="you@company.com" />
      </label>
      <label className="hp" aria-hidden="true">Company<input type="text" name="company" tabIndex={-1} autoComplete="off" /></label>
      <button className="btn btn--primary" type="submit" disabled={busy}>Join the waitlist</button>
      <p className="form__status" role="status" aria-live="polite">{status}</p>
    </form>
  );
}
