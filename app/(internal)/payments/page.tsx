import { supabase } from "@/lib/supabase";
import { isSquareConfigured, getSquareLocationId } from "@/lib/square";
import PaymentsList, { type SquareInvoiceRow, type SquarePaymentRow } from "./PaymentsList";
import SyncSquareButton from "./SyncSquareButton";
import { errorClass, headingClass, subTextClass } from "../ui";

export const dynamic = "force-dynamic";

type RelatedCustomer = { name: string | null } | { name: string | null }[] | null;

function relatedName(value: RelatedCustomer) {
  if (!value) return null;
  return Array.isArray(value) ? (value[0]?.name ?? null) : value.name;
}

export default async function PaymentsPage() {
  const configured = isSquareConfigured();
  const hasLocation = Boolean(getSquareLocationId());

  const [invoicesResult, paymentsResult] = configured
    ? await Promise.all([
        supabase
          .from("square_invoices")
          .select(
            "square_invoice_id, invoice_number, title, status, total_cents, amount_paid_cents, amount_due_cents, public_url, square_customer_name, customer_id, document_id, square_created_at, customers(name)"
          )
          .order("square_created_at", { ascending: false }),
        supabase
          .from("square_payments")
          .select(
            "square_payment_id, status, total_cents, source_type, card_brand, card_last4, receipt_url, note, customer_id, square_created_at, customers(name)"
          )
          .order("square_created_at", { ascending: false }),
      ])
    : [
        { data: [] as never[], error: null },
        { data: [] as never[], error: null },
      ];

  const missingTable =
    invoicesResult.error?.message?.includes("square_invoices") ||
    paymentsResult.error?.message?.includes("square_payments") ||
    invoicesResult.error?.message?.includes("square_customer_id") ||
    invoicesResult.error?.message?.includes("square_invoice_id");

  const invoices: SquareInvoiceRow[] = (invoicesResult.data ?? []).map((row) => {
    const record = row as SquareInvoiceRow & { customers: RelatedCustomer };
    return {
      ...record,
      customers: { name: relatedName(record.customers) },
    };
  });

  const payments: SquarePaymentRow[] = (paymentsResult.data ?? []).map((row) => {
    const record = row as SquarePaymentRow & { customers: RelatedCustomer };
    return {
      ...record,
      customers: { name: relatedName(record.customers) },
    };
  });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Square Payments</h1>
          <p className={subTextClass}>
            Live payment status from Square Invoices and the card reader. Sync pulls the last year of payments
            and current invoices, matches CRM customers when email/phone/name lines up, and marks a matching CRM
            invoice paid.
          </p>
        </div>
        <SyncSquareButton />
      </div>

      {!configured && (
        <p className={errorClass}>SQUARE_ACCESS_TOKEN is missing on Vercel — nothing to sync yet.</p>
      )}
      {configured && !hasLocation && (
        <p className={subTextClass}>
          SQUARE_LOCATION_ID is missing, so payments can sync but Square invoices cannot.
        </p>
      )}
      {missingTable && (
        <p className={errorClass}>
          Run db/migrations/0040_square_payment_sync.sql in Supabase, then hit Sync Square.
        </p>
      )}
      {invoicesResult.error && !missingTable && (
        <p className={errorClass}>Error loading Square invoices: {invoicesResult.error.message}</p>
      )}
      {paymentsResult.error && !missingTable && (
        <p className={errorClass}>Error loading Square payments: {paymentsResult.error.message}</p>
      )}

      {!missingTable && <PaymentsList invoices={invoices} payments={payments} />}
    </div>
  );
}
