"use client";

import { useActionState } from "react";
import { createBotKey, revokeBotKey, type BotKeyState } from "./actions";
import SubmitButton from "../SubmitButton";
import { buttonClass, buttonSecondaryClass, errorClass, inputClass, itemSubClass, subTextClass } from "../ui";

export type BotKeyRow = {
  id: string;
  name: string;
  token_hint: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "never";

function RevokeButton({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState<BotKeyState, FormData>(revokeBotKey, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Cut ${name} off? It stops working right away.`)) e.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="id" value={id} />
      <SubmitButton className={buttonSecondaryClass} pendingText="Revoking…">
        Revoke
      </SubmitButton>
      {state?.error && (
        <span role="alert" className={errorClass}>
          {state.error}
        </span>
      )}
    </form>
  );
}

export default function BotKeysCard({ keys, tableMissing }: { keys: BotKeyRow[]; tableMissing: boolean }) {
  const [state, action] = useActionState<BotKeyState, FormData>(createBotKey, null);
  const live = keys.filter((k) => !k.revoked_at);
  const revoked = keys.filter((k) => k.revoked_at);

  return (
    <div className="flex flex-col gap-4">
      <p className={subTextClass}>
        One key per bot for the Field Board API. A bot&apos;s posts carry its name, so one bot can&apos;t post as
        another, and you can cut off one bot without touching the rest. The old shared key keeps working until you
        remove it from Vercel.
      </p>

      {tableMissing && <p className={errorClass}>Run SQL 0068 to turn this on.</p>}

      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className={itemSubClass}>Bot name</span>
          <input
            key={state?.name ?? ""}
            name="name"
            required
            defaultValue={state?.name ?? ""}
            placeholder="quo"
            className={inputClass}
            autoComplete="off"
          />
        </label>
        <SubmitButton className={buttonClass} pendingText="Making…">
          Make key
        </SubmitButton>
      </form>
      {state?.error && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
      {state?.created && (
        <div className="flex flex-col gap-2 rounded-lg border border-white/15 p-3">
          <p className={subTextClass}>
            Key for <strong className="text-white">{state.created.name}</strong>. Copy it into that bot now. It
            won&apos;t be shown again.
          </p>
          <input readOnly value={state.created.key} onFocus={(e) => e.currentTarget.select()} className={inputClass} />
          <button
            type="button"
            className={`${buttonSecondaryClass} w-fit`}
            onClick={() => navigator.clipboard?.writeText(state.created?.key ?? "")}
          >
            Copy
          </button>
        </div>
      )}

      {live.length > 0 && (
        <ul className="flex flex-col gap-2">
          {live.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className={itemSubClass}>
                <strong className="text-white">{k.name}</strong> · …{k.token_hint} · last used {when(k.last_used_at)}
              </span>
              <RevokeButton id={k.id} name={k.name} />
            </li>
          ))}
        </ul>
      )}
      {revoked.length > 0 && (
        <details>
          <summary className={itemSubClass}>Revoked ({revoked.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {revoked.map((k) => (
              <li key={k.id} className={itemSubClass}>
                {k.name} · …{k.token_hint} · revoked {when(k.revoked_at)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
