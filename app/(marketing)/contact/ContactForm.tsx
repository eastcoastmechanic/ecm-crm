"use client";

import { useActionState, useState } from "react";
import { sendContactMessage, type ContactState } from "./actions";
import SubmitButton from "../../(internal)/SubmitButton";
import { buttonClass, errorClass, inputClass } from "../../(internal)/ui";
import { SpamTrap } from "../SpamTrap";

export default function ContactForm() {
  const [state, action] = useActionState<ContactState, FormData>(sendContactMessage, null);
  // Controlled, so an error keeps what was typed.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  return (
    <form action={action} className="flex flex-col gap-4 rounded-xl border border-white/8 bg-white/3 p-5">
      <SpamTrap />
      <label className="flex flex-col gap-1 text-xs text-g300">
        Name
        <input name="name" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Your full name" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Email
        <input
          name="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          placeholder="you@example.com"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Message
        <textarea
          name="message"
          required
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={inputClass}
          placeholder="How can we help?"
        />
      </label>
      {state?.error && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
      <SubmitButton className={`${buttonClass} w-fit`} pendingText="Sending…">
        Send Message
      </SubmitButton>
    </form>
  );
}
