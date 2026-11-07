"use client";

import { useActionState, useState } from "react";
import { saveTemplate, sendCampaignNow, sendTestToMe, type SendState, type TemplateState, type TestState } from "./actions";
import { buttonClass, buttonSecondaryClass, errorClass, inputClass, itemSubClass } from "../ui";

type Template = { sms_text: string | null; email_subject: string | null; email_body: string | null };

export function TemplateForm({ kind, initial, placeholders }: { kind: string; initial: Template; placeholders: string }) {
  const [state, action, pending] = useActionState<TemplateState, FormData>(saveTemplate, null);
  const [testState, testAction, testing] = useActionState<TestState, FormData>(sendTestToMe, null);
  // Controlled, so a failed save keeps what was typed (React resets uncontrolled fields after an action).
  const [sms, setSms] = useState(initial.sms_text ?? "");
  const [subject, setSubject] = useState(initial.email_subject ?? "");
  const [body, setBody] = useState(initial.email_body ?? "");

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="kind" value={kind} />
      <p className={itemSubClass}>
        Fill-ins you can use: {placeholders}. Texts get &ldquo;Reply STOP to opt out.&rdquo; added if they don&apos;t
        mention STOP. Emails get the unsubscribe link and shop address added at the bottom.
      </p>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Text message ({sms.length} characters; over 160 sends as more than one text)
        <textarea name="sms_text" rows={3} maxLength={640} value={sms} onChange={(e) => setSms(e.target.value)} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Email subject
        <input name="email_subject" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Email message
        <textarea name="email_body" rows={7} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} className={inputClass} />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={`${buttonSecondaryClass} w-fit disabled:opacity-50`}>
          {pending ? "Saving…" : "Save wording"}
        </button>
        <button type="submit" formAction={testAction} disabled={testing} className={`${buttonSecondaryClass} w-fit disabled:opacity-50`}>
          {testing ? "Sending test…" : "Send a test to me"}
        </button>
        {state?.saved && <span className={itemSubClass}>Saved.</span>}
        {state?.error && <span className={errorClass}>{state.error}</span>}
      </div>
      {testState?.sentTo && <p className={itemSubClass}>Test sent to {testState.sentTo}. No customer got anything.</p>}
      {testState?.error && <p className={errorClass}>{testState.error}</p>}
    </form>
  );
}

export function SendForm({ kind, count, ready }: { kind: string; count: number; ready: boolean }) {
  const [state, action, pending] = useActionState<SendState, FormData>(sendCampaignNow, null);
  const [confirmed, setConfirmed] = useState(false);
  const result = state?.result;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="kind" value={kind} />
      <label className="flex items-center gap-2 text-sm text-white">
        <input type="checkbox" name="confirm" value="yes" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        Send this to the {count} customer{count === 1 ? "" : "s"} listed below
      </label>
      <button
        type="submit"
        disabled={pending || !ready || !confirmed || count === 0}
        className={`${buttonClass} w-fit disabled:opacity-50`}
      >
        {pending ? "Sending…" : "Send now"}
      </button>
      {!ready && <p className={itemSubClass}>Write and save the text and the email first.</p>}
      {state?.error && <p className={errorClass}>{state.error}</p>}
      {result && (
        <div className={itemSubClass}>
          <p className="text-white">
            Sent {result.sent}. Failed {result.failed}. Skipped {result.skipped} (already messaged in the last 30 days).
            {result.leftOver > 0 ? ` ${result.leftOver} more are still on the list: press Send again.` : ""}
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {result.errors.slice(0, 20).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
