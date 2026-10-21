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

// ---------------------------------------------------------------------------
// Write helpers (estimate inbox). Everything here creates DRAFT records only;
// nothing is published or sent to the customer. Needs a token with
// CUSTOMERS_READ/WRITE, ORDERS_WRITE and INVOICES_WRITE.
// ---------------------------------------------------------------------------

export type SquareWriteResult<T> = { ok: true; value: T } | { ok: false; error: string };

type SquareError = { category?: string; code?: string; detail?: string };

function plainSquareError(status: number, errors: SquareError[] | undefined, what: string): string {
  const codes = (errors ?? []).map((e) => e.code).filter(Boolean);
  if (status === 401 || codes.includes("UNAUTHORIZED") || codes.includes("ACCESS_TOKEN_EXPIRED")) {
    return "Square rejected the token. Check SQUARE_ACCESS_TOKEN on Vercel.";
  }
  if (status === 403 || codes.includes("INSUFFICIENT_SCOPES") || codes.includes("FORBIDDEN")) {
    return `The Square token can't ${what}. It needs CUSTOMERS_WRITE, ORDERS_WRITE and INVOICES_WRITE.`;
  }
  const detail = (errors ?? [])[0]?.detail;
  return `Square said no (${what}): ${detail ?? `HTTP ${status}`}`;
}

async function squarePost<T>(path: string, body: unknown, what: string): Promise<SquareWriteResult<T>> {
  const headers = squareHeaders();
  if (!headers) return { ok: false, error: "Square isn't set up (SQUARE_ACCESS_TOKEN missing)." };
  let res: Response;
  try {
    res = await fetch(`${SQUARE_BASE_URL}${path}`, {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "Couldn't reach Square. Try again." };
  }
  const json = (await res.json().catch(() => ({}))) as T & { errors?: SquareError[] };
  if (!res.ok) {
    // Log status and error codes only -- never headers, tokens, or request bodies.
    console.error(`Square ${what} failed (${res.status}):`, (json.errors ?? []).map((e) => e.code).join(","));
    return { ok: false, error: plainSquareError(res.status, json.errors, what) };
  }
  return { ok: true, value: json };
}

export type SquareCustomerInput = {
  idempotencyKey: string;
  referenceId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
};

/** Find a Square customer by exact email, then phone; create one if none. */
export async function findOrCreateSquareCustomer(
  input: SquareCustomerInput
): Promise<SquareWriteResult<string>> {
  const filters: Array<Record<string, unknown>> = [];
  if (input.email) filters.push({ email_address: { exact: input.email.trim() } });
  if (input.phone) filters.push({ phone_number: { exact: input.phone.trim() } });

  for (const filter of filters) {
    const found = await squarePost<{ customers?: SquareCustomer[] }>(
      "/v2/customers/search",
      { query: { filter }, limit: 1 },
      "look up the customer"
    );
    if (!found.ok) return found;
    const id = found.value.customers?.[0]?.id;
    if (id) return { ok: true, value: id };
  }

  const parts = (input.name ?? "").trim().split(/\s+/).filter(Boolean);
  const created = await squarePost<{ customer?: SquareCustomer }>(
    "/v2/customers",
    {
      idempotency_key: input.idempotencyKey,
      reference_id: input.referenceId,
      given_name: parts[0] ?? undefined,
      family_name: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
      email_address: input.email?.trim() || undefined,
      phone_number: input.phone?.trim() || undefined,
    },
    "create the customer"
  );
  if (!created.ok) return created;
  const id = created.value.customer?.id;
  return id ? { ok: true, value: id } : { ok: false, error: "Square didn't return a customer id." };
}

export async function createSquareOrder(input: {
  idempotencyKey: string;
  locationId: string;
  customerId: string;
  referenceId: string;
  lineItems: Array<{ name: string; quantity: string; base_price_money: { amount: number; currency: string } }>;
}): Promise<SquareWriteResult<string>> {
  const res = await squarePost<{ order?: { id?: string } }>(
    "/v2/orders",
    {
      idempotency_key: input.idempotencyKey,
      order: {
        location_id: input.locationId,
        customer_id: input.customerId,
        reference_id: input.referenceId,
        line_items: input.lineItems,
      },
    },
    "create the order"
  );
  if (!res.ok) return res;
  const id = res.value.order?.id;
  return id ? { ok: true, value: id } : { ok: false, error: "Square didn't return an order id." };
}

/**
 * Create the invoice as a DRAFT. Square leaves new invoices in DRAFT; we never
 * call /publish, so nothing goes to the customer until Josh sends it in Square.
 */
export async function createSquareDraftInvoice(input: {
  idempotencyKey: string;
  locationId: string;
  orderId: string;
  customerId: string;
  title: string;
  hasEmail: boolean;
  paymentRequests: unknown[];
}): Promise<SquareWriteResult<string>> {
  const res = await squarePost<{ invoice?: { id?: string; status?: string } }>(
    "/v2/invoices",
    {
      idempotency_key: input.idempotencyKey,
      invoice: {
        location_id: input.locationId,
        order_id: input.orderId,
        primary_recipient: { customer_id: input.customerId },
        title: input.title,
        delivery_method: input.hasEmail ? "EMAIL" : "SHARE_MANUALLY",
        payment_requests: input.paymentRequests,
        accepted_payment_methods: { card: true },
      },
    },
    "create the invoice"
  );
  if (!res.ok) return res;
  const id = res.value.invoice?.id;
  if (!id) return { ok: false, error: "Square didn't return an invoice id." };
  if (res.value.invoice?.status && res.value.invoice.status !== "DRAFT") {
    return { ok: false, error: `Square made the invoice as ${res.value.invoice.status}, not a draft. Check Square.` };
  }
  return { ok: true, value: id };
}
