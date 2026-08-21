import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getSquareRevenue, getSquareMoneyOwed } from "@/lib/square";
import {
  buttonClass,
  buttonSecondaryClass,
  headingClass,
  itemSubClass,
  itemTitleClass,
  subTextClass,
} from "../ui";

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

const jobStatusClass: Record<string, string> = {
  requested: "bg-white/8 text-g300",
  scheduled: "bg-blue/40 text-white",
  in_progress: "bg-gold/20 text-gold",
  complete: "bg-green-l text-green",
  cancelled: "bg-white/8 text-g300",
};

export default async function DashboardPage() {
  const today = new Date().toISOString().slice(0, 10);
  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);

  const [
    { count: totalCustomers },
    { count: activeJobs },
    { data: outstandingInvoices },
    { data: paidDocuments },
    { count: contractsRenewing },
    { data: upcomingJobs },
    { data: recentDocuments },
    squareRevenue,
    squareMoneyOwed,
  ] = await Promise.all([
    supabase.from("customers").select("*", { count: "exact", head: true }),
    supabase
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .in("status", ["requested", "scheduled", "in_progress"]),
    supabase.from("documents").select("total").eq("type", "invoice").eq("status", "sent"),
    supabase.from("documents").select("total").eq("status", "paid"),
    supabase
      .from("service_contracts")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .gte("end_date", today)
      .lte("end_date", in30Days.toISOString().slice(0, 10)),
    supabase
      .from("jobs")
      .select("*, customers(name), properties(address)")
      .gte("scheduled_at", today)
      .in("status", ["requested", "scheduled", "in_progress"])
      .order("scheduled_at", { ascending: true })
      .limit(5),
    supabase
      .from("documents")
      .select("*, customers(name)")
      .order("created_at", { ascending: false })
      .limit(5),
    // Real revenue mostly flows through Square (POS, Square Invoices), not
    // the CRM's own documents -- see lib/square.ts. Shown as its own card
    // rather than merged into "Revenue Collected" to avoid double-counting
    // a job that's tracked in both places.
    getSquareRevenue("2000-01-01T00:00:00Z"),
    process.env.SQUARE_LOCATION_ID
      ? getSquareMoneyOwed(process.env.SQUARE_LOCATION_ID)
      : Promise.resolve({ totalCents: 0, count: 0 }),
  ]);

  const outstandingTotal = (outstandingInvoices ?? []).reduce((sum, doc) => sum + (doc.total ?? 0), 0);
  const revenueTotal = (paidDocuments ?? []).reduce((sum, doc) => sum + (doc.total ?? 0), 0);

  const stats = [
    { label: "Customers", value: totalCustomers ?? 0 },
    { label: "Active Jobs", value: activeJobs ?? 0 },
    {
      label: "Outstanding Invoices",
      value: formatPrice(outstandingTotal),
      sub: `${outstandingInvoices?.length ?? 0} unpaid`,
    },
    { label: "Revenue Collected", value: formatPrice(revenueTotal) },
    {
      label: "Revenue Collected (Square)",
      value: formatPrice(squareRevenue.totalCents / 100),
      sub: `${squareRevenue.count} payments`,
    },
    {
      label: "Money Owed (Square)",
      value: formatPrice(squareMoneyOwed.totalCents / 100),
      sub: `${squareMoneyOwed.count} unpaid invoices`,
    },
    { label: "Contracts Renewing", value: contractsRenewing ?? 0, sub: "next 30 days" },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Dashboard</h1>
          <p className={subTextClass}>Overview of customers, jobs, and revenue.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/customers" className={buttonSecondaryClass}>
            New Customer
          </Link>
          <Link href="/documents/new" className={buttonClass}>
            New Document
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-white/8 bg-white/3 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-g500">
              {stat.label}
            </div>
            <div className="mt-1 font-display text-2xl font-extrabold">{stat.value}</div>
            {stat.sub && <div className={itemSubClass}>{stat.sub}</div>}
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">Upcoming Jobs</h2>
            <Link href="/jobs" className="text-xs font-semibold text-accent">
              View all
            </Link>
          </div>
          <div className="flex flex-col divide-y divide-white/8 rounded-xl border border-white/8 bg-white/3">
            {(upcomingJobs?.length ?? 0) === 0 && (
              <p className={`${subTextClass} p-4`}>No upcoming jobs scheduled.</p>
            )}
            {upcomingJobs?.map((job) => (
              <div key={job.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <div className={itemTitleClass}>
                    {job.customers?.name ?? "Unknown customer"}
                    {job.properties?.address ? ` — ${job.properties.address}` : ""}
                  </div>
                  <div className={itemSubClass}>
                    {job.scheduled_at ? new Date(job.scheduled_at).toLocaleString() : "No date"}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    jobStatusClass[job.status] ?? "bg-white/8 text-g300"
                  }`}
                >
                  {job.status.replace("_", " ")}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">Recent Documents</h2>
            <Link href="/documents" className="text-xs font-semibold text-accent">
              View all
            </Link>
          </div>
          <div className="flex flex-col divide-y divide-white/8 rounded-xl border border-white/8 bg-white/3">
            {(recentDocuments?.length ?? 0) === 0 && (
              <p className={`${subTextClass} p-4`}>No documents yet.</p>
            )}
            {recentDocuments?.map((doc) => (
              <Link
                key={doc.id}
                href={`/documents/${doc.id}`}
                className="flex items-center justify-between gap-3 p-4 hover:bg-white/3"
              >
                <div>
                  <div className={itemTitleClass}>{doc.doc_number ?? doc.type}</div>
                  <div className={itemSubClass}>
                    {doc.customers?.name ?? "Unknown customer"} ·{" "}
                    {new Date(doc.created_at).toLocaleDateString()}
                  </div>
                </div>
                <span className="font-mono text-sm text-white">
                  {formatPrice(doc.total ?? 0)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
