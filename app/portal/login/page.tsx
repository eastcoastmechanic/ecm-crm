"use client";

import { useState } from "react";
import { createPortalBrowserClient } from "@/lib/supabase-portal/client";
import { buttonClass, headingClass, inputClass, subTextClass, errorClass } from "../../(internal)/ui";

export default function PortalLoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "verifying" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError("");

    const supabase = createPortalBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/portal/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setStatus("error");
      return;
    }
    setStatus("sent");
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setStatus("verifying");
    setError("");

    const supabase = createPortalBrowserClient();
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });

    if (error) {
      setError(error.message);
      setStatus("sent");
      return;
    }
    window.location.href = "/portal";
  }

  if (status === "sent" || status === "verifying") {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className={headingClass}>Check your email</h1>
          <p className={subTextClass}>
            We sent a sign-in link to {email}. Open it on this device to log in, or enter the
            6-digit code from that email below.
          </p>
        </div>
        <form onSubmit={handleVerifyCode} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-g300">
            6-digit code
            <input
              type="text"
              inputMode="numeric"
              required
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${inputClass} w-40 text-center font-mono text-lg tracking-widest`}
            />
          </label>
          {error && <p className={errorClass}>{error}</p>}
          <button
            type="submit"
            disabled={status === "verifying"}
            className={`${buttonClass} w-fit disabled:opacity-50`}
          >
            {status === "verifying" ? "Verifying…" : "Verify Code"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className={headingClass}>Sign in</h1>
        <p className={subTextClass}>
          Enter your email and we&apos;ll send you a link (and a backup code) to sign in — no
          password needed.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-g300">
          Email
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </label>
        {error && <p className={errorClass}>{error}</p>}
        <button type="submit" disabled={status === "sending"} className={`${buttonClass} w-fit disabled:opacity-50`}>
          {status === "sending" ? "Sending…" : "Send sign-in link"}
        </button>
      </form>
    </div>
  );
}
