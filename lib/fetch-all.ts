/**
 * Read every row of a Supabase query, a page at a time.
 *
 * Supabase (PostgREST) returns at most 1000 rows per request and says nothing
 * when it cuts a result short. Anything that has to see every row (the Square
 * sync matching invoices to documents, a full customer list) pages through with
 * .range() instead.
 *
 * `page(from, to)` must build a fresh query with a stable order (e.g.
 * .order("id")) and apply .range(from, to). Paging stops at the first empty
 * page, so it is still right if the server's row cap is set lower than
 * `pageSize`.
 */

export const SUPABASE_PAGE_SIZE = 1000;

/**
 * Split ids for `.in()` filters. The ids go in the request URL, so a few
 * hundred UUIDs in one filter can exceed the URL length limit.
 */
export function chunk<T>(items: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Read a page-size limit like "?show=400" from the URL: a whole number, at
 * least `step`, rounded to a multiple of `step`, at most `max`.
 */
export function pageLimit(raw: string | string[] | undefined, step: number, max: number): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(value) || value <= step) return step;
  return Math.min(max, Math.ceil(value / step) * step);
}

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts: { pageSize?: number; maxRows?: number } = {}
): Promise<{ data: T[]; error: string | null }> {
  const pageSize = opts.pageSize ?? SUPABASE_PAGE_SIZE;
  // Guard against a query that never runs dry (e.g. a missing .range()).
  const maxRows = opts.maxRows ?? 100_000;
  const rows: T[] = [];

  while (rows.length < maxRows) {
    const from = rows.length;
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { data: rows, error: error.message };
    const batch = data ?? [];
    if (batch.length === 0) break;
    rows.push(...batch);
  }

  return { data: rows, error: null };
}
