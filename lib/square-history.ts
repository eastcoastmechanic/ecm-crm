// Square full-history import. Reads every invoice (all locations), payment and
// refund since the account began and stores them in square_invoices,
// square_payments and square_refunds. Read only on the Square side.
//
// It never touches CRM documents (no links, no paid/unpaid changes): that stays
// with the regular sync, which only acts on strong matches. Re-running is safe:
// rows are upserted on the Square id, and links the sync already made are kept.

import { supabase } from "@/lib/supabase";
import { chunk } from "@/lib/fetch-all";
import {
  bulkRetrieveSquareCustomers,
  isSquareConfigured,
  listSquareLocations,
  listSquarePaymentsPage,
  listSquareRefundsPage,
  searchSquareInvoicesPage,
  type SquareInvoice,
  type SquarePayment,
  type SquareRefund,
} from "@/lib/square";
import {
  buildHistoryTasks,
  historyInvoiceRow,
  historyPaymentRow,
  historyRefundRow,
  type ExistingInvoice,
  type ExistingPayment,
  type ExistingRefund,
  type HistoryProgress,
  type HistoryTask,
} from "@/lib/square-history-map";

/** Work per server call. Well under any function limit; the browser calls again to go on. */
const STEP_BUDGET_MS = 20_000;
const ID_CHUNK = 100;

export type HistoryStepResult = { progress: HistoryProgress; error?: string };

async function selectIn<T>(table: string, columns: string, column: string, values: string[]): Promise<T[]> {
  const unique = [...new Set(values.filter(Boolean))];
  const out: T[] = [];
  for (const part of chunk(unique, ID_CHUNK)) {
    const { data, error } = await supabase.from(table).select(columns).in(column, part);
    if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

async function upsertRows(table: string, rows: Record<string, unknown>[], conflict: string) {
  for (const part of chunk(rows, ID_CHUNK)) {
    const { error } = await supabase.from(table).upsert(part, { onConflict: conflict });
    if (error) throw new Error(`Saving ${table} failed: ${error.message}`);
  }
}

/** CRM customer id per Square customer id, only where the CRM customer is already linked to it. */
async function crmCustomersBySquareId(squareIds: string[]): Promise<Map<string, string>> {
  const rows = await selectIn<{ id: string; square_customer_id: string }>(
    "customers",
    "id, square_customer_id",
    "square_customer_id",
    squareIds
  );
  return new Map(rows.map((r) => [r.square_customer_id, r.id]));
}

async function importInvoices(items: SquareInvoice[], p: HistoryProgress, now: string) {
  const valid = items.filter((i) => i.id && i.status);
  const existing = await selectIn<ExistingInvoice & { square_invoice_id: string }>(
    "square_invoices",
    "square_invoice_id, customer_id, paid_at",
    "square_invoice_id",
    valid.map((i) => i.id as string)
  );
  const byId = new Map(existing.map((e) => [e.square_invoice_id, e]));
  p.counts.invoices.found += valid.length;
  p.counts.invoices.isNew += valid.filter((i) => !byId.has(i.id as string)).length;
  if (p.dryRun || valid.length === 0) return;

  const squareIds = valid.map((i) => i.primary_recipient?.customer_id ?? "").filter(Boolean);
  const [crm, squareCustomers] = await Promise.all([
    crmCustomersBySquareId(squareIds),
    bulkRetrieveSquareCustomers([...new Set(squareIds)]),
  ]);
  const rows = valid
    .map((invoice) => {
      const sqId = invoice.primary_recipient?.customer_id;
      return historyInvoiceRow(invoice, {
        squareCustomer: sqId ? squareCustomers.get(sqId) : undefined,
        crmCustomerId: sqId ? (crm.get(sqId) ?? null) : null,
        existing: byId.get(invoice.id as string),
        now,
      });
    })
    .filter((r): r is Record<string, unknown> => r !== null);
  await upsertRows("square_invoices", rows, "square_invoice_id");
}

async function importPayments(items: SquarePayment[], p: HistoryProgress, now: string) {
  const valid = items.filter((i) => i.id && i.status);
  const existing = await selectIn<ExistingPayment & { square_payment_id: string }>(
    "square_payments",
    "square_payment_id, customer_id, square_invoice_id",
    "square_payment_id",
    valid.map((i) => i.id as string)
  );
  const byId = new Map(existing.map((e) => [e.square_payment_id, e]));
  p.counts.payments.found += valid.length;
  p.counts.payments.isNew += valid.filter((i) => !byId.has(i.id as string)).length;
  if (p.dryRun || valid.length === 0) return;

  const [crm, invoices] = await Promise.all([
    crmCustomersBySquareId(valid.map((i) => i.customer_id ?? "")),
    selectIn<{ square_invoice_id: string; square_order_id: string }>(
      "square_invoices",
      "square_invoice_id, square_order_id",
      "square_order_id",
      valid.map((i) => i.order_id ?? "")
    ),
  ]);
  const invoiceByOrder = new Map(invoices.map((i) => [i.square_order_id, i.square_invoice_id]));
  const rows = valid
    .map((payment) =>
      historyPaymentRow(payment, {
        crmCustomerId: payment.customer_id ? (crm.get(payment.customer_id) ?? null) : null,
        invoiceId: payment.order_id ? (invoiceByOrder.get(payment.order_id) ?? null) : null,
        existing: byId.get(payment.id as string),
        now,
      })
    )
    .filter((r): r is Record<string, unknown> => r !== null);
  await upsertRows("square_payments", rows, "square_payment_id");
}

async function importRefunds(items: SquareRefund[], p: HistoryProgress, now: string) {
  const valid = items.filter((i) => i.id && i.status);
  const existing = await selectIn<ExistingRefund & { square_refund_id: string }>(
    "square_refunds",
    "square_refund_id, customer_id",
    "square_refund_id",
    valid.map((i) => i.id as string)
  );
  const byId = new Map(existing.map((e) => [e.square_refund_id, e]));
  p.counts.refunds.found += valid.length;
  p.counts.refunds.isNew += valid.filter((i) => !byId.has(i.id as string)).length;
  if (p.dryRun || valid.length === 0) return;

  const payments = await selectIn<{ square_payment_id: string; square_customer_id: string | null; customer_id: string | null }>(
    "square_payments",
    "square_payment_id, square_customer_id, customer_id",
    "square_payment_id",
    valid.map((i) => i.payment_id ?? "")
  );
  const paymentById = new Map(payments.map((x) => [x.square_payment_id, x]));
  const rows = valid
    .map((refund) =>
      historyRefundRow(refund, {
        payment: refund.payment_id ? paymentById.get(refund.payment_id) : undefined,
        existing: byId.get(refund.id as string),
        now,
      })
    )
    .filter((r): r is Record<string, unknown> => r !== null);
  await upsertRows("square_refunds", rows, "square_refund_id");
}

async function runTaskPage(task: HistoryTask, p: HistoryProgress, now: string): Promise<string | null> {
  if (task.kind === "invoices") {
    const page = await searchSquareInvoicesPage(task.locationId, p.cursor);
    await importInvoices(page.items, p, now);
    return page.cursor;
  }
  const window = {
    locationId: task.locationId,
    beginTime: task.beginTime as string,
    endTime: task.endTime as string,
    cursor: p.cursor,
  };
  if (task.kind === "payments") {
    const page = await listSquarePaymentsPage(window);
    await importPayments(page.items, p, now);
    return page.cursor;
  }
  const page = await listSquareRefundsPage(window);
  await importRefunds(page.items, p, now);
  return page.cursor;
}

/**
 * Do as many pages as fit in one call and return where it stopped. On an error
 * the progress returned is the last good point, so pressing Continue picks up
 * from there (re-doing at most one page, which upserts the same rows).
 */
export async function runSquareHistoryStep(input: HistoryProgress): Promise<HistoryStepResult> {
  const progress: HistoryProgress = { ...input, counts: structuredClone(input.counts) };
  if (!isSquareConfigured()) return { progress, error: "SQUARE_ACCESS_TOKEN is not set on Vercel." };

  if (progress.taskIndex === 0 && progress.cursor === null) {
    const { error } = await supabase.from("square_refunds").select("square_refund_id").limit(1);
    if (error) {
      console.error("[square-history] square_refunds not readable:", error.message);
      return { progress, error: "Run SQL 0081 in Supabase first (it adds the Square refunds table)." };
    }
  }

  const started = Date.now();
  const now = new Date().toISOString();
  try {
    const tasks = buildHistoryTasks(await listSquareLocations(), progress.startedAt);
    if (tasks.length === 0) return { progress, error: "Square returned no locations for this account." };
    progress.totalTasks = tasks.length;

    while (progress.taskIndex < tasks.length && Date.now() - started < STEP_BUDGET_MS) {
      // Work on a copy so a failed page doesn't leave half-counted totals behind.
      const attempt: HistoryProgress = { ...progress, counts: structuredClone(progress.counts) };
      const next = await runTaskPage(tasks[progress.taskIndex], attempt, now);
      progress.counts = attempt.counts;
      if (next) {
        progress.cursor = next;
      } else {
        progress.taskIndex += 1;
        progress.cursor = null;
      }
    }
    progress.done = progress.taskIndex >= tasks.length;
    return { progress };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[square-history] step failed:", message);
    return { progress, error: `Stopped: ${message.slice(0, 300)}. Press Continue to pick up where it stopped.` };
  }
}
