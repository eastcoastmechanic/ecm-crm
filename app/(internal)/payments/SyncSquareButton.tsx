"use client";

import { useState } from "react";
import { runSquarePaymentSync } from "./actions";
import { buttonClass, errorClass, subTextClass } from "../ui";

export default function SyncSquareButton() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await runSquarePaymentSync();
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage(
        `Synced ${result.invoicesUpserted} invoices and ${result.paymentsUpserted} payments. Linked ${result.customersLinked} customers. Updated ${result.documentsUpdated} CRM documents.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Square sync failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button type="button" onClick={handleSync} disabled={pending} className={`${buttonClass} disabled:opacity-50`}>
        {pending ? "Syncing Square…" : "Sync Square"}
      </button>
      {message && <p className={subTextClass}>{message}</p>}
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}
