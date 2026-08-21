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

type SquarePayment = {
  status: string;
  total_money?: { amount: number };
};

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
    const json = (await res.json()) as { payments?: SquarePayment[]; cursor?: string };
    for (const payment of json.payments ?? []) {
      if (payment.status !== "COMPLETED") continue;
      totalCents += payment.total_money?.amount ?? 0;
      count += 1;
    }
    cursor = json.cursor;
  } while (cursor);

  return { totalCents, count };
}

type SquareInvoice = {
  status: string;
  next_payment_amount_money?: { amount: number };
};

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
    const json = (await res.json()) as { invoices?: SquareInvoice[]; cursor?: string };
    for (const invoice of json.invoices ?? []) {
      if (!OUTSTANDING_STATUSES.has(invoice.status)) continue;
      totalCents += invoice.next_payment_amount_money?.amount ?? 0;
      count += 1;
    }
    cursor = json.cursor;
  } while (cursor);

  return { totalCents, count };
}
