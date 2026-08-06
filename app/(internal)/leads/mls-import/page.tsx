import Link from "next/link";
import { importMlsCsv } from "./actions";
import SubmitButton from "../../SubmitButton";
import { headingClass, subTextClass, buttonClass, inputClass, errorClass } from "../../ui";

export default async function MlsImportPage({
  searchParams,
}: {
  searchParams: Promise<{ imported?: string; skipped?: string; errors?: string; errorDetail?: string }>;
}) {
  const { imported, skipped, errors, errorDetail } = await searchParams;
  const hasResult = imported !== undefined;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className={headingClass}>Import MLS Export</h1>
        <p className={subTextClass}>
          Export recently-closed sales in your service area from your MLS account (a normal search →
          export, done manually by you — not automated), then upload the CSV here. Expected columns:
          address, city, year_built, close_date (column names are matched loosely; extra columns are
          ignored). Only rows with a year_built at least 10 years old become leads, drafted as a
          &quot;new to the neighborhood&quot; mailer for you to print and send.
        </p>
      </div>

      {hasResult && (
        <div className="flex flex-col gap-1 rounded-xl border border-white/8 bg-white/3 p-4 text-sm">
          <p className="text-white">
            Imported <span className="font-bold text-accent">{imported}</span> new lead(s)
            {Number(skipped) > 0 && <> — {skipped} already imported previously, skipped</>}.
          </p>
          {errors && (
            <p className={errorClass}>
              {errors} row(s) failed: {errorDetail}
            </p>
          )}
        </div>
      )}

      <form action={importMlsCsv} className="flex flex-col gap-4 rounded-xl border border-white/8 bg-white/3 p-4">
        <label className="flex flex-col gap-1 text-xs text-g300">
          MLS export CSV
          <input type="file" name="csv" accept=".csv" required className={inputClass} />
        </label>
        <SubmitButton className={`${buttonClass} w-fit`} pendingText="Importing…">
          Import
        </SubmitButton>
      </form>

      <Link href="/leads" className={subTextClass}>
        &larr; Back to leads
      </Link>
    </div>
  );
}
