"use client";

import { useState } from "react";
import { buttonSecondaryClass, cardClass, errorClass, subTextClass } from "../ui";
import { runSquareExport } from "./export-actions";
import type { SquareExportResult } from "@/lib/square-export";

/** Owner only. One press saves spreadsheets of everything in Square to SharePoint. */
export default function SquareExportPanel() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SquareExportResult | null>(null);

  async function handleExport() {
    setPending(true);
    setResult(null);
    try {
      setResult(await runSquareExport());
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Square export failed." });
    } finally {
      setPending(false);
    }
  }

  const c = result?.counts;
  return (
    <section className={`${cardClass} flex flex-col gap-3`}>
      <div>
        <h2 className="font-display text-lg font-bold text-white">Export Square to SharePoint</h2>
        <p className={subTextClass}>
          Saves spreadsheets (CSV, opens in Excel) of every Square customer, invoice, payment, refund and catalog item,
          all years, to the ecmjobs site under Shared Documents / Square Export / today&apos;s date. Reads Square only.
          Running it again the same day replaces that day&apos;s files. Can take a minute or two.
        </p>
      </div>
      <div>
        <button type="button" onClick={handleExport} disabled={pending} className={`${buttonSecondaryClass} disabled:opacity-50`}>
          {pending ? "Exporting…" : "Export Square to SharePoint"}
        </button>
      </div>
      {result?.error && <p className={errorClass}>{result.error}</p>}
      {c && (
        <p className="text-sm text-g300">
          Saved {c.customers} customers, {c.invoices} invoices, {c.payments} payments, {c.refunds} refunds and{" "}
          {c.catalogRows} catalog rows.{" "}
          {result?.folderUrl ? (
            <a href={result.folderUrl} target="_blank" rel="noreferrer" className="font-semibold text-accent">
              Open the folder
            </a>
          ) : (
            "Find them in SharePoint under Square Export."
          )}
        </p>
      )}
    </section>
  );
}
