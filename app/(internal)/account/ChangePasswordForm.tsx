"use client";

import { useState } from "react";
import { updatePassword } from "./actions";
import { buttonClass, errorClass, inputClass, subTextClass } from "../ui";

export default function ChangePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    setSuccess(false);

    const formData = new FormData();
    formData.set("password", password);
    formData.set("confirm_password", confirmPassword);

    const result = await updatePassword(formData);
    setPending(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    setSuccess(true);
    setPassword("");
    setConfirmPassword("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" autoComplete="on">
      <label className="flex flex-col gap-1 text-xs text-g300">
        New password
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Confirm new password
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={inputClass}
        />
      </label>
      {error && <p className={errorClass}>{error}</p>}
      {success && (
        <p className={subTextClass}>
          Password updated. Your browser may now offer to save it for Face ID / Touch ID autofill
          next time.
        </p>
      )}
      <button type="submit" disabled={pending} className={`${buttonClass} w-fit disabled:opacity-50`}>
        {pending ? "Saving…" : "Update Password"}
      </button>
    </form>
  );
}
