"use client";

import { useActionState } from "react";
import SubmitButton from "../SubmitButton";
import { buttonClass, buttonSecondaryClass, cardClass, errorClass, subTextClass } from "../ui";
import { runSquareCatalogImport } from "./square-catalog-actions";

function money(value: number | null) {
  if (value === null) return "No price";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

/** Owner only. Preview first, then copy Square catalog items into the price book. */
export default function SquareCatalogImportPanel() {
  const [state, action] = useActionState(runSquareCatalogImport, null);
  const ok = state && !state.error;
  return (
    <section className={`${cardClass} flex flex-col gap-3`}>
      <div>
        <h2 className="font-display text-lg font-bold text-white">Import from Square catalog</h2>
        <p className={subTextClass}>
          Reads your Square items and adds each one (each size or option as its own line) to the price book with
          Square&apos;s price. Anything already here, by Square id or the same name, is skipped and its price is left
          alone. Nothing is written to Square. Safe to run again.
        </p>
      </div>
      <form action={action} className="flex flex-wrap gap-2">
        <input type="hidden" name="dry_run" value="1" />
        <SubmitButton className={buttonSecondaryClass} pendingText="Reading Square…">
          Preview
        </SubmitButton>
      </form>
      {state?.error && <p className={errorClass}>{state.error}</p>}

      {ok && state.dryRun && (
        <div className="flex flex-col gap-2 text-sm text-g300">
          <p>
            Square has {state.squareItems} items ({state.squareVariations} sizes/options). Would add{" "}
            <span className="text-white">{state.willCreate}</span>
            {state.noPrice > 0 ? ` (${state.noPrice} with no price, priced at sale in Square)` : ""}, skip{" "}
            {state.alreadyThere} already in the price book
            {state.skipped.map((s) => `, ${s.count} ${s.reason}`).join("")}.
          </p>
          {!state.hasSquareIdColumn && (
            <p className={errorClass}>
              SQL 0082 hasn&apos;t been run yet, so this preview matched by name only. Run it in Supabase, then
              Preview again to import.
            </p>
          )}
          {state.preview.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-g300">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Name</th>
                    <th className="py-1 pr-3 font-medium">Category</th>
                    <th className="py-1 text-right font-medium">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {state.preview.map((row, i) => (
                    <tr key={`${row.name}-${i}`} className="border-t border-white/8">
                      <td className="py-1 pr-3 text-white">{row.name}</td>
                      <td className="py-1 pr-3">{row.category ?? "—"}</td>
                      <td className="py-1 text-right">{money(row.unit_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {state.willCreate > state.preview.length && (
                <p className="mt-1 text-xs">…and {state.willCreate - state.preview.length} more.</p>
              )}
            </div>
          )}
        </div>
      )}

      {ok && !state.dryRun && (
        <p className="text-sm text-g300">
          Added {state.created} to the price book
          {state.failed ? `, ${state.failed} failed (press Preview and run again to retry)` : ""}.
        </p>
      )}

      {ok && state.dryRun && state.hasSquareIdColumn && state.willCreate > 0 && (
        <form action={action}>
          <SubmitButton className={buttonClass} pendingText="Importing…">
            Import {state.willCreate} items
          </SubmitButton>
        </form>
      )}
    </section>
  );
}
