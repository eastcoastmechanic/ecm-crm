// Square -> SharePoint export. Reads the whole Square account (read only):
// customers, invoices (all locations), payments and refunds since the account
// began, and catalog items, then saves one CSV per list to the ecmjobs site:
//   Shared Documents / Square Export / YYYY-MM-DD (New York date)
// Running it again on the same day replaces that day's files.

import { SQUARE_BASE_URL, squareHeaders } from "@/lib/square";
import { graphConfigured, graphFetch } from "@/lib/graph-auth";
import { jobsDriveId } from "@/lib/job-folders";
import { etDateKey } from "@/lib/tz";
import {
  catalogSheet,
  customerSheet,
  exportFolderPath,
  invoiceSheet,
  paymentSheet,
  refundSheet,
  toCsv,
  type ExportCatalogObject,
  type ExportCustomer,
  type ExportInvoice,
  type ExportPayment,
  type ExportRefund,
} from "@/lib/square-export-rows";

export type SquareExportResult = {
  error?: string;
  folderUrl?: string;
  counts?: { customers: number; invoices: number; payments: number; refunds: number; catalogRows: number };
};

type Location = { id?: string; name?: string; created_at?: string };

/** Safety stop so a cursor that never ends can't loop forever (100 per page => 50,000 records). */
const MAX_PAGES = 500;
/** Square launched in 2009; used when a location has no start date. */
const FALLBACK_START = "2009-01-01T00:00:00.000Z";

async function squareJson<T>(path: string, what: string, init?: { method: "POST"; body: unknown }): Promise<T> {
  const headers = squareHeaders();
  if (!headers) throw new Error("SQUARE_ACCESS_TOKEN is not set on Vercel.");
  const res = await fetch(`${SQUARE_BASE_URL}${path}`, {
    method: init?.method ?? "GET",
    headers,
    cache: "no-store",
    ...(init ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) throw new Error(`Square ${what} failed (${res.status})`);
  return (await res.json()) as T;
}

/** Follow Square's cursor on a GET list until the end. */
async function getAll<T>(path: string, key: string, what: string, params: Record<string, string> = {}): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const qs = new URLSearchParams({ ...params, ...(cursor ? { cursor } : {}) });
    const json = await squareJson<Record<string, unknown>>(`${path}?${qs}`, what);
    out.push(...((json[key] as T[] | undefined) ?? []));
    cursor = typeof json.cursor === "string" ? json.cursor : undefined;
    pages += 1;
  } while (cursor && pages < MAX_PAGES);
  if (cursor) throw new Error(`Square ${what} has more than ${MAX_PAGES} pages; stopped rather than save a partial list.`);
  return out;
}

async function invoicesFor(locationId: string): Promise<ExportInvoice[]> {
  const out: ExportInvoice[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const json = await squareJson<{ invoices?: ExportInvoice[]; cursor?: string }>("/v2/invoices/search", "invoices search", {
      method: "POST",
      body: { query: { filter: { location_ids: [locationId] } }, limit: 200, ...(cursor ? { cursor } : {}) },
    });
    out.push(...(json.invoices ?? []));
    cursor = json.cursor;
    pages += 1;
  } while (cursor && pages < MAX_PAGES);
  if (cursor) throw new Error("Square invoices have too many pages; stopped rather than save a partial list.");
  return out;
}

/** Calendar-year windows (UTC) from `start` to now, so no single request spans the whole history. */
function yearWindows(start: string, now: Date): Array<{ begin_time: string; end_time: string }> {
  const out: Array<{ begin_time: string; end_time: string }> = [];
  for (let y = new Date(start).getUTCFullYear(); y <= now.getUTCFullYear(); y += 1) {
    const end = Math.min(Date.UTC(y + 1, 0, 1), now.getTime());
    out.push({ begin_time: new Date(Date.UTC(y, 0, 1)).toISOString(), end_time: new Date(end).toISOString() });
  }
  return out;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function upload(folder: string, name: string, csv: string): Promise<void> {
  const res = await graphFetch(`/drives/${jobsDriveId()}/root:/${encodePath(`${folder}/${name}`)}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "text/csv; charset=utf-8" },
    body: csv,
  });
  if (!res.ok) throw new Error(`SharePoint upload of ${name} failed (${res.status})`);
}

/** Owner only (checked in the action). Reads Square, writes CSVs to SharePoint, returns the folder link. */
export async function exportSquareToSharePoint(now = new Date()): Promise<SquareExportResult> {
  if (!squareHeaders()) return { error: "SQUARE_ACCESS_TOKEN is not set on Vercel." };
  if (!graphConfigured()) return { error: "Microsoft (SharePoint) sign-in isn't set up on Vercel." };

  try {
    const locations = await getAll<Location>("/v2/locations", "locations", "locations list");
    const located = locations.filter((l): l is Location & { id: string } => Boolean(l.id));
    if (located.length === 0) return { error: "Square returned no locations for this account." };
    const names = new Map(located.map((l) => [l.id, l.name ?? l.id]));
    const locationName = (id?: string) => (id ? (names.get(id) ?? id) : "");

    const starts = located.map((l) => Date.parse(l.created_at ?? "")).filter(Number.isFinite);
    const start = starts.length ? new Date(Math.min(...starts)).toISOString() : FALLBACK_START;
    const windows = yearWindows(start, now);

    const customers = await getAll<ExportCustomer>("/v2/customers", "customers", "customers list", { limit: "100" });
    const catalog = await getAll<ExportCatalogObject>("/v2/catalog/list", "objects", "catalog list", { types: "ITEM,CATEGORY" });

    const invoices: ExportInvoice[] = [];
    const payments: ExportPayment[] = [];
    const refunds: ExportRefund[] = [];
    for (const loc of located) {
      invoices.push(...(await invoicesFor(loc.id)));
      for (const w of windows) {
        const params = { location_id: loc.id, ...w, sort_order: "ASC", limit: "100" };
        payments.push(...(await getAll<ExportPayment>("/v2/payments", "payments", "payments list", params)));
        refunds.push(...(await getAll<ExportRefund>("/v2/refunds", "refunds", "refunds list", params)));
      }
    }
    // A record exactly on a year boundary can come back in both windows.
    const uniq = <T extends { id?: string }>(list: T[]) => [...new Map(list.map((x, i) => [x.id ?? `#${i}`, x])).values()];
    const allPayments = uniq(payments);
    const allRefunds = uniq(refunds);

    const catalogTable = catalogSheet(catalog);
    const folder = exportFolderPath(etDateKey(now));
    await upload(folder, "customers.csv", toCsv(customerSheet(customers)));
    await upload(folder, "invoices.csv", toCsv(invoiceSheet(invoices, locationName)));
    await upload(folder, "payments.csv", toCsv(paymentSheet(allPayments, locationName)));
    await upload(folder, "refunds.csv", toCsv(refundSheet(allRefunds, locationName)));
    await upload(folder, "catalog-items.csv", toCsv(catalogTable));

    const res = await graphFetch(`/drives/${jobsDriveId()}/root:/${encodePath(folder)}?$select=webUrl`);
    const folderUrl = res.ok ? ((await res.json()) as { webUrl?: string }).webUrl : undefined;

    return {
      folderUrl,
      counts: {
        customers: customers.length,
        invoices: invoices.length,
        payments: allPayments.length,
        refunds: allRefunds.length,
        catalogRows: catalogTable.rows.length,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[square-export] failed:", message);
    return { error: `Export stopped: ${message.slice(0, 300)}` };
  }
}
