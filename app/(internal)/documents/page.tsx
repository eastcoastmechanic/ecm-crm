import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { pageLimit } from "@/lib/fetch-all";
import { one } from "@/lib/appointment-reminder";
import DocumentsList from "./DocumentsList";
import { buttonClass, buttonSecondaryClass, errorClass, headingClass, inputClass, subTextClass } from "../ui";

/** Documents shown per "Show older" step. Supabase stops at 1000 rows without saying so. */
const DOCS_STEP = 200;
const DOCS_MAX = 1000;

/** Keep a search term safe inside a PostgREST or() filter. Apostrophes stay (O'Brien). */
function cleanSearch(raw: string | undefined) {
  return (raw ?? "").replace(/[,()%*\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; q?: string }>;
}) {
  const params = await searchParams;
  const limit = pageLimit(params.show, DOCS_STEP, DOCS_MAX);
  const term = cleanSearch(params.q);

  let query = supabase
    .from("documents")
    .select("id, doc_number, type, status, total, created_at, customers(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (term) {
    // Match the document number, or any customer whose name matches.
    const { data: customerRows } = await supabase
      .from("customers")
      .select("id")
      .ilike("name", `%${term}%`)
      .limit(200);
    const ids = (customerRows ?? []).map((c) => c.id as string);
    query = query.or(
      [`doc_number.ilike.%${term}%`, ids.length ? `customer_id.in.(${ids.join(",")})` : null].filter(Boolean).join(",")
    );
  }

  const [{ data: documents, error, count }, { count: waiting }] = await Promise.all([
    query,
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("type", "estimate")
      .eq("status", "draft")
      .is("routed_to", null),
  ]);

  const shown = documents?.length ?? 0;
  const total = count ?? shown;
  const qs = (show: number) => `/documents?show=${show}${term ? `&q=${encodeURIComponent(term)}` : ""}`;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Documents</h1>
          <p className={subTextClass}>
            AI-generated estimates, invoices, proposals, and equipment condition assessments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/documents/inbox" className={buttonSecondaryClass}>
            Estimates to review{waiting ? ` (${waiting})` : ""}
          </Link>
          <Link href="/documents/mass-save-rebate/new" className={buttonSecondaryClass}>
            + New Mass Save Rebate
          </Link>
          <Link href="/documents/warranty/new" className={buttonSecondaryClass}>
            + New Warranty
          </Link>
          <Link href="/documents/assessment/new" className={buttonSecondaryClass}>
            + New Condition Assessment
          </Link>
          <Link href="/documents/new" className={buttonClass}>
            New Document
          </Link>
        </div>
      </div>

      {error && (
        <p className={errorClass}>Error loading documents: {error.message}</p>
      )}

      {term && (
        <p className={subTextClass}>
          {total} document{total === 1 ? "" : "s"} matching &ldquo;{term}&rdquo;.{" "}
          <Link href="/documents" className="font-semibold text-accent">
            Clear search
          </Link>
        </p>
      )}

      <DocumentsList documents={(documents ?? []).map((doc) => ({ ...doc, customers: one(doc.customers) }))} />

      {(total > shown || term) && (
        <div className="flex flex-col gap-3">
          {total > shown && (
            <p className={subTextClass}>
              Showing the newest {shown} of {total}.{" "}
              {limit < DOCS_MAX ? (
                <Link href={qs(limit + DOCS_STEP)} className="font-semibold text-accent">
                  Show older
                </Link>
              ) : (
                "Search by number or customer to find older ones."
              )}
            </p>
          )}
          <form action="/documents" method="get" className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              name="q"
              defaultValue={term}
              placeholder="Find any document by number or customer name"
              aria-label="Find any document by number or customer name"
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button type="submit" className={buttonSecondaryClass}>
              Search all
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
