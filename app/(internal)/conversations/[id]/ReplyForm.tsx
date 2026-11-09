"use client";

import { useState } from "react";
import { sendManualReply } from "./actions";
import { buttonClass, errorClass, inputClass } from "../../ui";

/**
 * Text reply box. Submitted by hand so a failed send (opted-out number, gateway
 * down) shows the reason here and keeps what was typed. Clears after a send.
 */
export default function ReplyForm({ conversationId }: { conversationId: string }) {
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        setError("");
        setSending(true);
        try {
          const result = await sendManualReply(null, data);
          if (result?.sent) form.reset();
          if (result?.error) setError(result.error);
        } catch {
          setError("Couldn't send. Your text is still in the box, try again.");
        } finally {
          setSending(false);
        }
      }}
    >
      <input type="hidden" name="conversation_id" value={conversationId} />
      <div className="flex items-center gap-2">
        <input
          name="message"
          placeholder="Send a text reply…"
          required
          disabled={sending}
          className={`${inputClass} flex-1`}
        />
        <button type="submit" disabled={sending} className={`${buttonClass} disabled:opacity-50`}>
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </form>
  );
}
