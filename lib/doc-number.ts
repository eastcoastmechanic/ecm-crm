import { supabase } from "@/lib/supabase";

/**
 * Document numbers (EST-1001, INV-1001, CON-1001 ...).
 *
 * The numbers come from the database function next_doc_number() (SQL 0071),
 * which keeps one counter per prefix under a row lock, so a delete or two
 * creates at the same moment can never hand out a number twice.
 *
 * Until Josh runs 0071 that function does not exist, so we fall back to the old
 * "count + 1001" rule, raised past the highest recent number of that prefix so
 * a delete no longer makes the next number repeat one still in use.
 */

export const DOC_NUMBER_PREFIX: Record<string, string> = {
  estimate: "EST",
  invoice: "INV",
  proposal: "PROP",
  contract: "CON",
  warranty: "WTY",
  pm_report: "PM",
  assessment: "CA",
};

/** First number for a prefix with no documents yet. */
export const DOC_NUMBER_BASE = 1001;

/** How many recent numbers the fallback looks at for the highest one in use. */
const FALLBACK_RECENT = 200;

export function docNumberPrefix(type: string): string {
  return DOC_NUMBER_PREFIX[type] ?? "DOC";
}

export function formatDocNumber(prefix: string, value: number): string {
  return `${prefix}-${value}`;
}

/** The number part of "INV-1042" for prefix "INV", or null if it is not that shape. */
export function parseDocNumber(prefix: string, docNumber: string | null | undefined): number | null {
  if (!docNumber) return null;
  const match = /^([A-Za-z]+)-(\d{1,15})$/.exec(docNumber.trim());
  if (!match || match[1] !== prefix) return null;
  const value = Number(match[2]);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Fallback rule used only before 0071 is run: the old count + 1001, but never
 * at or below a number that is already in use.
 */
export function fallbackDocNumberValue(
  prefix: string,
  count: number,
  existing: (string | null | undefined)[]
): number {
  let next = DOC_NUMBER_BASE + Math.max(0, count);
  for (const docNumber of existing) {
    const value = parseDocNumber(prefix, docNumber);
    if (value !== null && value >= next) next = value + 1;
  }
  return next;
}

/**
 * True when PostgREST says the function is not there (0071 not run yet).
 * PGRST202 = not in the schema cache; 42883 = Postgres "function does not exist".
 */
export function isMissingFunctionError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("could not find the function") || (message.includes("function") && message.includes("does not exist"));
}

export type DocNumberResult = { docNumber: string; error?: undefined } | { docNumber?: undefined; error: string };

/** Next document number for a document type. Returns { error } instead of throwing. */
export async function allocateDocNumber(type: string): Promise<DocNumberResult> {
  const prefix = docNumberPrefix(type);

  const { data, error } = await supabase.rpc("next_doc_number", { p_prefix: prefix });
  if (!error) {
    if (typeof data === "string" && data) return { docNumber: data };
    return { error: "Could not get a document number: the database returned nothing." };
  }
  if (!isMissingFunctionError(error)) {
    return { error: `Could not get a document number: ${error.message}` };
  }

  // 0071 not run yet: old rule, kept clear of numbers already in use.
  const [countResult, recentResult] = await Promise.all([
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("type", type),
    supabase
      .from("documents")
      .select("doc_number")
      .like("doc_number", `${prefix}-%`)
      .order("created_at", { ascending: false })
      .limit(FALLBACK_RECENT),
  ]);
  if (countResult.error) return { error: `Could not get a document number: ${countResult.error.message}` };
  const recent = recentResult.error ? [] : ((recentResult.data ?? []) as { doc_number: string | null }[]);
  const value = fallbackDocNumberValue(
    prefix,
    countResult.count ?? 0,
    recent.map((r) => r.doc_number)
  );
  return { docNumber: formatDocNumber(prefix, value) };
}

/** Same as allocateDocNumber, for library code that already throws on failure. */
export async function nextDocNumberOrThrow(type: string): Promise<string> {
  const result = await allocateDocNumber(type);
  if (result.error !== undefined) throw new Error(result.error);
  return result.docNumber;
}
