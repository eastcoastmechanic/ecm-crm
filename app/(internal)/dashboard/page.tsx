import { Suspense } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getSyncedSquareRevenue, getSyncedSquareMoneyOwed } from "@/lib/square-synced";
import { getStaffRole } from "@/lib/require-role";
import { etDateKey, etDayRange, formatEtDateTime, formatEtTime } from "@/lib/tz";
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

const statCardClass = "rounded-xl border border-white/8 bg-white/3 p-4";

// The Square numbers come from live Square API calls, which are slow. They render
// in their own boundary so the rest of the dashboard shows up immediately.
async function SquareStats() {
  const [squareRevenue, squareMoneyOwed] = await Promise.all([getSyncedSquareRevenue(), getSyncedSquareMoneyOwed()]);
  const latestSync = [squareRevenue.syncedAt, squareMoneyOwed.syncedAt].filter(Boolean).sort().pop() ?? null;
  const syncNote = latestSync ? `as of ${formatEtDateTime(latestSync, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "not synced yet";
  const cards = [
    {
      label: "Revenue Collected (Square)",
      value: formatPrice(squareRevenue.totalCents / 100),
      sub: `${squareRevenue.count} payments · ${syncNote}`,
    },
    {
      label: "Money Owed (Square)",
      value: formatPrice(squareMoneyOwed.totalCents / 100),
      sub: `${squareMoneyOwed.count} unpaid invoices · ${syncNote}`,
    },
  ];
  return (
    <>
      {cards.map((stat) => (
        <div key={stat.label} className={statCardClass}>
          <div className="text-xs font-semibold uppercase tracking-wide text-g500">{stat.label}</div>
          <div className="mt-1 font-display text-2xl font-extrabold">{stat.value}</div>
          <div className={itemSubClass}>{stat.sub}</div>
        </div>
      ))}
    </>
  );
}

function SquareStatsFallback() {
  return (
    <>
      {["Revenue Collected (Square)", "Money Owed (Square)"].map((label) => (
        <div key={label} className={statCardClass}>
          <div className="text-xs font-semibold uppercase tracking-wide text-g500">{label}</div>
          <div className="mt-1 font-display text-2xl font-extrabold text-g500">Loading…</div>
        </div>
      ))}
    </>
  );
}

export default async function DashboardPage() {
  // Revenue, money owed and invoice totals are owner/office only. Techs get a
  // minimal view and never trigger the Square or invoice queries below.
  const role = await getStaffRole();
  if (role === "tech") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className={headingClass}>Dashboard</h1>
        <p className={subTextClass}>Your work for today is on the field board.</p>
        <div>
          <Link href="/field-board" className={buttonClass}>
            Today&apos;s Jobs
          </Link>
        </div>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);

  const todayRange = etDayRange(etDateKey());

  const [
    { data: todaysJobs },
    { count: estimatesToReview },
    { count: totalCustomers },
    { count: activeJobs },
    { data: outstandingInvoices },
    { data: paidDocuments },
    { count: contractsRenewing },
    { data: upcomingJobs },
    { data: recentDocuments },
  ] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, status, scheduled_at, customers(name), properties(address)")
      .gte("scheduled_at", todayRange.start.toISOString())
      .lt("scheduled_at", todayRange.end.toISOString())
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true }),
    supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("type", "estimate")
      .eq("status", "draft")
      .is("routed_to", null),
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
          <Link href="/payments" className={buttonSecondaryClass}>
            Square Payments
          </Link>
          <Link href="/documents/new" className={buttonClass}>
            New Document
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Today</h2>
          <Link href="/jobs" className="text-xs font-semibold text-accent">
            All jobs
          </Link>
        </div>
        <div className="flex flex-col divide-y divide-white/8 rounded-xl border border-white/8 bg-white/3">
          {(todaysJobs?.length ?? 0) === 0 && <p className={`${subTextClass} p-4`}>No jobs scheduled today.</p>}
          {todaysJobs?.map((job) => {
            const customer = (Array.isArray(job.customers) ? job.customers[0] : job.customers) as { name: string | null } | null;
            const property = (Array.isArray(job.properties) ? job.properties[0] : job.properties) as { address: string | null } | null;
            return (
              <div key={job.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <div className={itemTitleClass}>
                    {customer?.name ?? "Unknown customer"}
                    {property?.address ? ` — ${property.address}` : ""}
                  </div>
                  <div className={itemSubClass}>{job.scheduled_at ? formatEtTime(job.scheduled_at) : "No time"}</div>
                </div>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    jobStatusClass[job.status] ?? "bg-white/8 text-g300"
                  }`}
                >
                  {job.status.replace("_", " ")}
                </span>
              </div>
            );
          })}
        </div>
        {(estimatesToReview ?? 0) > 0 && (
          <Link
            href="/documents/inbox"
            className="rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm font-semibold text-white hover:bg-accent/20"
          >
            {estimatesToReview} estimate{estimatesToReview === 1 ? "" : "s"} waiting for you to review
          </Link>
        )}
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
        <Suspense fallback={<SquareStatsFallback />}>
          <SquareStats />
        </Suspense>
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
