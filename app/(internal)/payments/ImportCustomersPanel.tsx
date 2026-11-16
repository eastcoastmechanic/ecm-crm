"use client";

import { useActionState } from "react";
import SubmitButton from "../SubmitButton";
import { buttonClass, buttonSecondaryClass, cardClass, errorClass, subTextClass } from "../ui";
import { runSquareCustomerImport } from "./import-actions";

/** Owner only. Preview first, then import the Square customer list into the CRM and fill gaps. */
export default function ImportCustomersPanel() {
  const [state, action] = useActionState(runSquareCustomerImport, null);
  const work = state ? state.willCreate + state.willLink + state.willFillFields + state.willAddNotes + state.willAddProperties : 0;
  return (
    <section className={`${cardClass} flex flex-col gap-3`}>
      <div>
        <h2 className="font-display text-lg font-bold text-white">Import Square customers</h2>
        <p className={subTextClass}>
          Square is now an archive. This reads your Square customer list, adds anyone not in the CRM, and links
          people already here by email or phone. Then it fills blanks from Square: email, phone, company, billing
          address, a property at the Square address if the customer has none there, and the Square note added to
          the customer notes. Nothing already in the CRM is overwritten and nothing is written to Square. Imported
          customers get no text consent, so they only get email until they opt in. Safe to run again.
        </p>
      </div>
      <form action={action} className="flex flex-wrap gap-2">
        <input type="hidden" name="dry_run" value="1" />
        <SubmitButton className={buttonSecondaryClass} pendingText="Counting…">
          Preview
        </SubmitButton>
      </form>
      {state?.error && <p className={errorClass}>{state.error}</p>}
      {state && !state.error && (
        <div className="text-sm text-g300">
          {state.dryRun ? (
            <>
              <p>
                Square has {state.squareTotal} customers. Would add {state.willCreate}, link {state.willLink} to
                existing, skip {state.alreadyLinked} already linked and {state.skipped} with no name, email or phone.
              </p>
              <p>
                Would fill blank details on {state.willFillFields}, add {state.willAddProperties} properties and add
                Square notes to {state.willAddNotes}.
              </p>
            </>
          ) : (
            <p>
              Added {state.created}, linked {state.linked}, filled details on {state.filled}, added{" "}
              {state.propertiesAdded} properties and {state.notesAdded} notes
              {state.failed ? `; ${state.failed} failed (run again to retry)` : ""}.
            </p>
          )}
        </div>
      )}
      {state && state.dryRun && !state.error && work > 0 && (
        <form action={action}>
          <SubmitButton className={buttonClass} pendingText="Importing…">
            Import and fill
          </SubmitButton>
        </form>
      )}
    </section>
  );
}
