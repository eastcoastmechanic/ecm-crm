"use client";

import Link from "next/link";
import SendDocumentForm from "../documents/[id]/SendDocumentForm";
import { buttonSecondaryClass, subTextClass } from "../ui";
import { formatMoney, type InvoicePrompt } from "@/lib/job-invoice-rules";

/**
 * Shown to owner/office right after a job is finished: the job's invoice is a draft, so send it
 * or open it. Send uses the normal send action (office-only check inside). A tech never gets a
 * prompt from the server, so this never renders for them.
 */
export default function FinishInvoicePanel({ prompt, onClose }: { prompt: InvoicePrompt; onClose?: () => void }) {
  const num = prompt.docNumber ?? "draft";
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-gold/30 bg-gold/5 p-3">
      <p className="text-sm text-white">
        {prompt.priced ? (
          <>
            Job finished. Invoice {num} {formatMoney(prompt.totalCents)} is a draft, not sent yet.
          </>
        ) : (
          <>Job finished. Invoice {num} has no price on file. Add line items, then send.</>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {prompt.priced && <SendDocumentForm id={prompt.id} label="Send now" />}
        <Link href={`/documents/${prompt.id}`} className={buttonSecondaryClass}>
          Open
        </Link>
        {onClose && (
          <button type="button" onClick={onClose} className={`${subTextClass} underline`}>
            Close
          </button>
        )}
      </div>
    </div>
  );
}
