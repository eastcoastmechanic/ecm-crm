"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createPortalBrowserClient } from "@/lib/supabase-portal/client";
import {
  buttonClass,
  buttonSecondaryClass,
  headingClass,
  inputClass,
  subTextClass,
  errorClass,
} from "../(internal)/ui";

function useRedirectTarget() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect");
  // Only ever follow a same-site relative path -- the param is attacker-controllable
  // (it comes straight from the URL), so reject anything that could send the
  // browser off-site (a bare "//host/..." is parsed as protocol-relative).
  return redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")
    ? redirectTo
    : "/dashboard";
}

export default function StaffLoginPage() {
  const redirectTarget = useRedirectTarget();
  const [mode, setMode] = useState<"password" | "code">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "verifying" | "error">("idle");
  const [error, setError] = useState("");

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault();
    setStatus("verifying");
    setError("");

    const supabase = createPortalBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setStatus("error");
      return;
    }
    window.location.href = redirectTarget;
  }

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError("");

    const supabase = createPortalBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
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
    window.location.href = redirectTarget;
  }

  if (status === "sent" || (status === "verifying" && mode === "code")) {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
        <div>
          <h1 className={headingClass}>Check your email</h1>
          <p className={subTextClass}>
            We sent a sign-in link to {email}. Open it on this device, or enter the 6-digit code
            from that email below.
          </p>
        </div>
        <form onSubmit={handleVerifyCode} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-g300">
            6-digit code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${inputClass} text-center font-mono text-lg tracking-widest`}
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
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className={headingClass}>Staff Sign In</h1>
        <p className={subTextClass}>
          {mode === "password"
            ? "Sign in with your email and password. Your phone can save this so it auto-fills with Face ID / Touch ID next time."
            : "First time here, or forgot your password? We'll email you a sign-in code — set a real password from Account settings once you're in."}
        </p>
      </div>

      {mode === "password" ? (
        <form
          onSubmit={handlePasswordSignIn}
          className="flex flex-col gap-3"
          autoComplete="on"
        >
          <label className="flex flex-col gap-1 text-xs text-g300">
            Email
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              placeholder="you@eastcoastmechanical.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </label>
          {error && <p className={errorClass}>{error}</p>}
          <button
            type="submit"
            disabled={status === "verifying"}
            className={`${buttonClass} w-fit disabled:opacity-50`}
          >
            {status === "verifying" ? "Signing in…" : "Sign In"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("code");
              setError("");
              setStatus("idle");
            }}
            className={`${buttonSecondaryClass} w-fit`}
          >
            Use email code instead
          </button>
        </form>
      ) : (
        <form onSubmit={handleSendCode} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-g300">
            Email
            <input
              type="email"
              autoComplete="username"
              required
              placeholder="you@eastcoastmechanical.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </label>
          {error && <p className={errorClass}>{error}</p>}
          <button
            type="submit"
            disabled={status === "sending"}
            className={`${buttonClass} w-fit disabled:opacity-50`}
          >
            {status === "sending" ? "Sending…" : "Send sign-in code"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("password");
              setError("");
              setStatus("idle");
            }}
            className={`${buttonSecondaryClass} w-fit`}
          >
            Back to password sign-in
          </button>
        </form>
      )}
    </div>
  );
}
