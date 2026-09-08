const SQUARE_BASE_URL = "https://connect.squareup.com";
const SQUARE_VERSION = "2026-08-19";

function squareHeaders() {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    "Square-Version": SQUARE_VERSION,
    "Content-Type": "application/json",
  };
}

export function isSquareConfigured() {
  return Boolean(process.env.SQUARE_ACCESS_TOKEN);
}

export function getSquareLocationId() {
  return process.env.SQUARE_LOCATION_ID ?? null;
}

type SquareMoney = { amount?: number; currency?: string };

export type SquarePayment = {
  id?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  order_id?: string;
  customer_id?: string;
  note?: string;
  receipt_url?: string;
  source_type?: string;
  amount_money?: SquareMoney;
  tip_money?: SquareMoney;
  total_money?: SquareMoney;
  card_details?: {
    card?: {
      last_4?: string;
      card_brand?: string;
    };
  };
};

export type SquareInvoiceRecipient = {
  customer_id?: string;
  given_name?: string;
  family_name?: string;
  email_address?: string;
  phone_number?: string;
};

export type SquareInvoice = {
  id?: string;
  status?: string;
  invoice_number?: string;
  title?: string;
  order_id?: string;
  created_at?: string;
  updated_at?: string;
  public_url?: string;
  primary_recipient?: SquareInvoiceRecipient;
  next_payment_amount_money?: SquareMoney;
  payment_requests?: Array<{
    computed_amount_money?: SquareMoney;
    total_completed_amount_money?: SquareMoney;
  }>;
};

export type SquareCustomer = {
  id?: string;
  given_name?: string;
  family_name?: string;
  company_name?: string;
  email_address?: string;
  phone_number?: string;
};

type SquarePaymentList = { payments?: SquarePayment[]; cursor?: string };
type SquareInvoiceSearch = { invoices?: SquareInvoice[]; cursor?: string };

// Real revenue: Square is the shop's actual payment processor (POS terminal,
// Square Invoices, in-person cards) -- the CRM's own `documents.status =
// 'paid'` total only reflects invoices generated and paid inside the CRM
// itself, which misses most of the real money. Queried live on every
// dashboard load rather than ingested via webhook into a table -- same
// "compute fresh from source" pattern the rest of the dashboard already
// uses, no staleness risk, no webhook signature-verification surface.
export async function getSquareRevenue(beginTime: string): Promise<{ totalCents: number; count: number }> {
  const headers = squareHeaders();
  if (!headers) return { totalCents: 0, count: 0 };

  let totalCents = 0;
  let count = 0;
  let cursor: string | undefined;

  do {
    const url = new URL(`${SQUARE_BASE_URL}/v2/payments`);
    url.searchParams.set("begin_time", beginTime);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString(), { headers, cache: "no-store" });
    if (!res.ok) {
      console.error(`Square payments list failed (${res.status}): ${await res.text()}`);
      break;
    }
    const json = (await res.json()) as SquarePaymentList;
    for (const payment of json.payments ?? []) {
      if (payment.status !== "COMPLETED") continue;
      totalCents += payment.total_money?.amount ?? 0;
      count += 1;
    }
    cursor = json.cursor;
  } while (cursor);

  return { totalCents, count };
}

const OUTSTANDING_STATUSES = new Set(["UNPAID", "PARTIALLY_PAID", "SCHEDULED"]);

// "Money owed" -- outstanding balance across Square Invoices, the shop's
// real invoicing system for actual jobs (the CRM's own `documents` table is
// mostly estimates/quotes, not where real AR lives). DRAFT is excluded
// (never sent, not real money owed yet); PAID/CANCELED/REFUNDED/FAILED are
// terminal and excluded too.
export async function getSquareMoneyOwed(locationId: string): Promise<{ totalCents: number; count: number }> {
  const headers = squareHeaders();
  if (!headers) return { totalCents: 0, count: 0 };

  let totalCents = 0;
  let count = 0;
  let cursor: string | undefined;

  do {
    const res = await fetch(`${SQUARE_BASE_URL}/v2/invoices/search`, {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify({
        query: { filter: { location_ids: [locationId] } },
        limit: 200,
        ...(cursor ? { cursor } : {}),
      }),
    });
    if (!res.ok) {
      console.error(`Square invoices search failed (${res.status}): ${await res.text()}`);
      break;
    }
    const json = (await res.json()) as SquareInvoiceSearch;
    for (const invoice of json.invoices ?? []) {
      if (!OUTSTANDING_STATUSES.has(invoice.status ?? "")) continue;
      totalCents += invoice.next_payment_amount_money?.amount ?? 0;
      count += 1;
    }
    cursor = json.cursor;
  } while (cursor);

  return { totalCents, count };
}

const MAX_PAGES = 50;

export async function listSquarePayments(beginTime: string): Promise<SquarePayment[]> {
  const headers = squareHeaders();
  if (!headers) throw new Error("SQUARE_ACCESS_TOKEN is not set.");

  const payments: SquarePayment[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    const url = new URL(`${SQUARE_BASE_URL}/v2/payments`);
    url.searchParams.set("begin_time", beginTime);
    url.searchParams.set("limit", "100");
    url.searchParams.set("sort_order", "DESC");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString(), { headers, cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Square payments list failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as SquarePaymentList;
    payments.push(...(json.payments ?? []));
    cursor = json.cursor;
    pages += 1;
  } while (cursor && pages < MAX_PAGES);

  return payments;
}

export async function listSquareInvoices(locationId: string): Promise<SquareInvoice[]> {
  const headers = squareHeaders();
  if (!headers) throw new Error("SQUARE_ACCESS_TOKEN is not set.");

  const invoices: SquareInvoice[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    const res = await fetch(`${SQUARE_BASE_URL}/v2/invoices/search`, {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify({
        query: { filter: { location_ids: [locationId] } },
        limit: 200,
        ...(cursor ? { cursor } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`Square invoices search failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as SquareInvoiceSearch;
    invoices.push(...(json.invoices ?? []));
    cursor = json.cursor;
    pages += 1;
  } while (cursor && pages < MAX_PAGES);

  return invoices;
}

export async function bulkRetrieveSquareCustomers(customerIds: string[]): Promise<Map<string, SquareCustomer>> {
  const headers = squareHeaders();
  const found = new Map<string, SquareCustomer>();
  if (!headers || customerIds.length === 0) return found;

  for (let i = 0; i < customerIds.length; i += 100) {
    const batch = customerIds.slice(i, i + 100);
    const res = await fetch(`${SQUARE_BASE_URL}/v2/customers/bulk-retrieve`, {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify({ customer_ids: batch }),
    });
    if (!res.ok) {
      console.error(`Square customer bulk-retrieve failed (${res.status}): ${await res.text()}`);
      continue;
    }
    const json = (await res.json()) as {
      responses?: Record<string, { customer?: SquareCustomer }>;
    };
    for (const [id, entry] of Object.entries(json.responses ?? {})) {
      if (entry.customer) found.set(id, entry.customer);
    }
  }

  return found;
}
