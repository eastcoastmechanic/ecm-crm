"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { itemSubClass, itemTitleClass, subTextClass } from "../ui";

const invoiceStatusClass: Record<string, string> = {
  PAID: "bg-green text-white",
  PARTIALLY_PAID: "bg-gold/20 text-gold",
  UNPAID: "bg-blue/40 text-white",
  SCHEDULED: "bg-blue/40 text-white",
  DRAFT: "bg-white/8 text-g300",
  CANCELED: "bg-white/8 text-g300",
  CANCELED_BY_RECIPIENT: "bg-white/8 text-g300",
  FAILED: "bg-accent/30 text-white",
  REFUNDED: "bg-white/8 text-g300",
};

const paymentStatusClass: Record<string, string> = {
  COMPLETED: "bg-green text-white",
  APPROVED: "bg-gold/20 text-gold",
  PENDING: "bg-blue/40 text-white",
  CANCELED: "bg-white/8 text-g300",
  FAILED: "bg-accent/30 text-white",
};

function formatPrice(cents: number | null) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents ?? 0) / 100);
}

export type SquareInvoiceRow = {
  square_invoice_id: string;
  invoice_number: string | null;
  title: string | null;
  status: string;
  total_cents: number;
  amount_paid_cents: number;
  amount_due_cents: number;
  public_url: string | null;
  square_customer_name: string | null;
  customer_id: string | null;
  document_id: string | null;
  square_created_at: string | null;
  customers: { name: string | null } | null;
};

export type SquarePaymentRow = {
  square_payment_id: string;
  status: string;
  total_cents: number;
  source_type: string | null;
  card_brand: string | null;
  card_last4: string | null;
  receipt_url: string | null;
  note: string | null;
  customer_id: string | null;
  square_created_at: string | null;
  customers: { name: string | null } | null;
};

export default function PaymentsList({
  invoices,
  payments,
}: {
  invoices: SquareInvoiceRow[];
  payments: SquarePaymentRow[];
}) {
  const [tab, setTab] = useState<"invoices" | "payments">("invoices");
  const [search, setSearch] = useState("");

  const filteredInvoices = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return invoices;
    return invoices.filter((row) =>
      [row.invoice_number, row.title, row.status, row.square_customer_name, row.customers?.name]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query))
    );
  }, [invoices, search]);

  const filteredPayments = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return payments;
    return payments.filter((row) =>
      [row.status, row.source_type, row.card_brand, row.card_last4, row.note, row.customers?.name]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query))
    );
  }, [payments, search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTab("invoices")}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
            tab === "invoices" ? "bg-accent text-white" : "bg-white/4 text-g300"
          }`}
        >
          Invoices ({invoices.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("payments")}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
            tab === "payments" ? "bg-accent text-white" : "bg-white/4 text-g300"
          }`}
        >
          Payments ({payments.length})
        </button>
        <input
          type="text"
          placeholder={tab === "invoices" ? "Search Square invoices…" : "Search Square payments…"}
          aria-label="Search Square records"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-48 flex-1 rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-sm text-white outline-none placeholder:text-g500 focus:border-accent focus:bg-accent/5"
        />
      </div>

      {tab === "invoices" ? (
        <div className="flex flex-col divide-y divide-white/8">
          {filteredInvoices.length === 0 && <p className={subTextClass}>No Square invoices match.</p>}
          {filteredInvoices.map((row) => (
            <div key={row.square_invoice_id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className={itemTitleClass}>
                  {row.invoice_number ?? row.title ?? row.square_invoice_id}
                  {row.title && row.invoice_number ? <span className={`ml-2 ${itemSubClass}`}>{row.title}</span> : null}
                </div>
                <div className={itemSubClass}>
                  {row.customer_id ? (
                    <Link href={`/customers/${row.customer_id}`} className="underline hover:text-white">
                      {row.customers?.name ?? row.square_customer_name ?? "Customer"}
                    </Link>
                  ) : (
                    row.square_customer_name ?? "Unmatched Square customer"
                  )}
                  {row.square_created_at ? ` · ${new Date(row.square_created_at).toLocaleDateString()}` : ""}
                  {row.document_id ? (
                    <>
                      {" · "}
                      <Link href={`/documents/${row.document_id}`} className="underline hover:text-white">
                        CRM document
                      </Link>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-3">
                <span className="font-mono text-sm text-white">{formatPrice(row.total_cents)}</span>
                {row.amount_due_cents > 0 && row.status !== "PAID" && (
                  <span className={itemSubClass}>due {formatPrice(row.amount_due_cents)}</span>
                )}
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    invoiceStatusClass[row.status] ?? "bg-white/8 text-g300"
                  }`}
                >
                  {row.status.replaceAll("_", " ")}
                </span>
                {row.public_url && (
                  <a href={row.public_url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-accent">
                    Square
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-white/8">
          {filteredPayments.length === 0 && <p className={subTextClass}>No Square payments match.</p>}
          {filteredPayments.map((row) => (
            <div key={row.square_payment_id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className={itemTitleClass}>
                  {row.customers?.name ?? "Unmatched payment"}
                  {row.source_type ? <span className={`ml-2 ${itemSubClass}`}>{row.source_type}</span> : null}
                </div>
                <div className={itemSubClass}>
                  {row.customer_id ? (
                    <Link href={`/customers/${row.customer_id}`} className="underline hover:text-white">
                      Open customer
                    </Link>
                  ) : (
                    "No CRM customer match"
                  )}
                  {row.square_created_at ? ` · ${new Date(row.square_created_at).toLocaleString()}` : ""}
                  {row.card_last4 ? ` · ${row.card_brand ?? "Card"} ${row.card_last4}` : ""}
                  {row.note ? ` · ${row.note}` : ""}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-3">
                <span className="font-mono text-sm text-white">{formatPrice(row.total_cents)}</span>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    paymentStatusClass[row.status] ?? "bg-white/8 text-g300"
                  }`}
                >
                  {row.status}
                </span>
                {row.receipt_url && (
                  <a href={row.receipt_url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-accent">
                    Receipt
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
