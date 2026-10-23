"use client";

import { useState, useTransition } from "react";
import { getInvoicePaymentLink } from "./actions";
import { buttonSecondaryClass, subTextClass } from "../../ui";

export default function PaymentLinkButton({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function make() {
    setError(null);
    setCopied(false);
    start(async () => {
      const res = await getInvoicePaymentLink(id);
      if (res.ok) setUrl(res.url);
      else setError(res.error);
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("Couldn't copy — select the link and copy it by hand.");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {!url ? (
        <button type="button" onClick={make} disabled={pending} className={buttonSecondaryClass}>
          {pending ? "Making link…" : "Get Payment Link"}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="w-48 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs" />
          <button type="button" onClick={copy} className={buttonSecondaryClass}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {error && <span className={subTextClass}>{error}</span>}
    </div>
  );
}
