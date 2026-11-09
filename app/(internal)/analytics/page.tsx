import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getStaffRole } from "@/lib/require-role";
import { one } from "@/lib/appointment-reminder";
import { addDaysToDateKey, etDateKey, formatEtDateTime } from "@/lib/tz";
import {
  etMonthKey,
  hoursByJob,
  jobProfit,
  leadSources,
  LEAD_REPORT_STAGES,
  NOT_LINKED,
  partsCostFromDocs,
  revenueByType,
  type CostLine,
} from "@/lib/reports";
import { buttonSecondaryClass, cardClass, headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

export const dynamic = "force-dynamic";

// Owner reports. Money is read server-side only after the owner check, so
// office and tech never receive it.

const PERIODS = { "3": 3, "12": 12, all: null } as const;
type PeriodKey = keyof typeof PERIODS;

function money(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

const sectionTitle = "text-xs font-bold uppercase tracking-wide text-g300";

type JobRow = {
  id: string;
  job_type: string | null;
  status: string;
  completed_at: string | null;
  tracked_hours: number | null;
  document_id: string | null;
  assigned_staff_id: string | null;
  customers: { name: string | null } | { name: string | null }[] | null;
};

type DocRow = {
  id: string;
  type: string;
  status: string;
  total: number | null;
  paid_at: string | null;
  job_id: string | null;
  balance_for_job_id: string | null;
  line_items: { items?: CostLine[]; fromDocumentId?: string | null } | null;
};

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  if ((await getStaffRole()) !== "owner") {
    return (
      <div className="flex flex-col gap-2">
        <h1 className={headingClass}>Reports</h1>
        <p className={subTextClass}>Reports are for the owner only.</p>
      </div>
    );
  }

  const { period: rawPeriod } = await searchParams;
  const period: PeriodKey = rawPeriod && rawPeriod in PERIODS ? (rawPeriod as PeriodKey) : "12";
  const months = PERIODS[period];
  // Start of the period: the first day of the New York month, `months` months back (current month counts).
  const today = etDateKey();
  let sinceIso: string | null = null;
  let sinceKey: string | null = null;
  if (months !== null) {
    const [y, m] = today.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - months, 1));
    sinceKey = start.toISOString().slice(0, 10);
    // A day early in UTC, then filtered by the New York month below, so nothing near midnight is lost.
    sinceIso = new Date(`${addDaysToDateKey(sinceKey, -1)}T00:00:00Z`).toISOString();
  }
  const inPeriod = (iso: string | null) => !!iso && (sinceKey === null || etDateKey(new Date(iso)) >= sinceKey);

  let jobsQuery = supabase
    .from("jobs")
    .select("id, job_type, status, completed_at, tracked_hours, document_id, assigned_staff_id, customers(name)")
    .in("status", ["complete", "completed"])
    .order("completed_at", { ascending: false });
  if (sinceIso) jobsQuery = jobsQuery.gte("completed_at", sinceIso);

  let paidQuery = supabase
    .from("documents")
    .select("id, total, paid_at, job_id, balance_for_job_id")
    .eq("status", "paid")
    .not("paid_at", "is", null);
  if (sinceIso) paidQuery = paidQuery.gte("paid_at", sinceIso);

  let leadsQuery = supabase.from("leads").select("source, status, created_at");
  if (sinceIso) leadsQuery = leadsQuery.gte("created_at", sinceIso);

  // "*" so voided_at (SQL 0078) comes back once it exists; voided time is left out below.
  let entriesQuery = supabase
    .from("job_time_entries")
    .select("*")
    .not("ended_at", "is", null);
  if (sinceIso) entriesQuery = entriesQuery.gte("started_at", sinceIso);

  const [jobsRes, paidRes, leadsRes, entriesRes, allJobsRes, staffRes] = await Promise.all([
    jobsQuery,
    paidQuery,
    leadsQuery,
    entriesQuery,
    supabase.from("jobs").select("id, job_type, document_id"),
    supabase.from("staff").select("id, name, email"),
  ]);
  let loadError = [jobsRes, paidRes, leadsRes, entriesRes, allJobsRes, staffRes].some((r) => r.error);

  const jobs = ((jobsRes.data ?? []) as JobRow[]).filter((j) => inPeriod(j.completed_at));
  const jobIds = jobs.map((j) => j.id);
  const priceDocIds = jobs.map((j) => j.document_id).filter((id): id is string => !!id);

  // Documents that price these jobs: the linked contract/estimate, or invoices made for the job.
  // Also every clocked minute on these jobs, whenever it was worked (not just inside the period).
  const linkedDocs: DocRow[] = [];
  const sourceItems = new Map<string, CostLine[] | null>();
  let jobEntries: { job_id: string; started_at: string; ended_at: string | null }[] = [];
  if (jobIds.length > 0) {
    const ids = jobIds.join(",");
    const filters = [`job_id.in.(${ids})`, `balance_for_job_id.in.(${ids})`];
    if (priceDocIds.length > 0) filters.push(`id.in.(${priceDocIds.join(",")})`);
    const [docsRes, timeRes] = await Promise.all([
      supabase
        .from("documents")
        .select("id, type, status, total, paid_at, job_id, balance_for_job_id, line_items")
        .or(filters.join(","))
        .neq("status", "void"),
      // "*" so voided_at (SQL 0078) comes back once it exists; voided time is not labor.
      supabase.from("job_time_entries").select("*").in("job_id", jobIds).not("ended_at", "is", null),
    ]);
    if (docsRes.error || timeRes.error) loadError = true;
    linkedDocs.push(...((docsRes.data ?? []) as DocRow[]));
    jobEntries = ((timeRes.data ?? []) as (typeof jobEntries[number] & { voided_at?: string | null })[]).filter((e) => !e.voided_at);

    // A contract keeps no line items; its parts list is on the estimate it was made from.
    const fromIds = linkedDocs
      .map((d) => d.line_items?.fromDocumentId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (fromIds.length > 0) {
      const { data, error } = await supabase.from("documents").select("id, line_items").in("id", fromIds);
      if (error) loadError = true;
      for (const d of (data ?? []) as Pick<DocRow, "id" | "line_items">[]) {
        sourceItems.set(d.id, Array.isArray(d.line_items?.items) ? d.line_items.items : null);
      }
    }
  }
  const docById = new Map(linkedDocs.map((d) => [d.id, d]));
  const itemsFor = (d: DocRow): CostLine[] | null => {
    if (Array.isArray(d.line_items?.items)) return d.line_items.items;
    const from = d.line_items?.fromDocumentId;
    return from ? (sourceItems.get(from) ?? null) : null;
  };

  const hourlyRate = Number(process.env.HOURLY_LABOR_RATE) || null;
  const clocked = hoursByJob(jobEntries);

  // ---- Profit per job ----
  const profitRows = jobs.map((job) => {
    const priceDoc = job.document_id ? docById.get(job.document_id) : undefined;
    // With a contract/estimate, it is the price (its deposit and balance invoices are parts of it,
    // so they are not added again). Without one, the job's own invoices are the price.
    // A draft made on Finish with no price on file has no lines yet: it is not a $0 price.
    const invoices = linkedDocs.filter(
      (d) =>
        d.type === "invoice" &&
        (d.job_id === job.id || d.balance_for_job_id === job.id) &&
        !(Array.isArray(d.line_items?.items) && d.line_items.items.length === 0)
    );
    const pricedBy = priceDoc ? [priceDoc] : invoices;
    const price = pricedBy.length > 0 ? pricedBy.reduce((s, d) => s + (d.total ?? 0), 0) : null;
    const parts = partsCostFromDocs(pricedBy.map(itemsFor));
    const hours = clocked.get(job.id) ?? (job.tracked_hours && job.tracked_hours > 0 ? job.tracked_hours : null);
    const collected = invoices.filter((d) => d.status === "paid").reduce((s, d) => s + (d.total ?? 0), 0);
    return { job, hours, collected, ...jobProfit({ price, parts, hours, hourlyRate }) };
  });
  const priced = profitRows.filter((r) => r.profit !== null);
  const totalProfit = priced.reduce((s, r) => s + (r.profit ?? 0), 0);
  const totalPrice = priced.reduce((s, r) => s + (r.price ?? 0), 0);

  // ---- Revenue ----
  const paid = (paidRes.data ?? []).filter((d) => inPeriod(d.paid_at));
  const revenueByMonth = new Map<string, number>();
  for (const doc of paid) {
    if (!doc.paid_at || !doc.total) continue;
    const key = etMonthKey(doc.paid_at);
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + doc.total);
  }
  const sortedMonths = [...revenueByMonth.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const paidTotal = paid.reduce((s, d) => s + (d.total ?? 0), 0);

  const allJobs = allJobsRes.data ?? [];
  const jobTypeById = new Map(allJobs.map((j) => [j.id, j.job_type as string | null]));
  const jobTypeByPriceDoc = new Map(
    allJobs.filter((j) => j.document_id).map((j) => [j.document_id as string, j.job_type as string | null])
  );
  const byType = revenueByType(
    paid.map((d) => {
      const jobId = d.balance_for_job_id ?? d.job_id;
      const jobType = (jobId ? jobTypeById.get(jobId) : undefined) ?? jobTypeByPriceDoc.get(d.id) ?? null;
      return { total: d.total, jobType };
    })
  );

  // ---- Leads ----
  const leadRows = leadSources((leadsRes.data ?? []).filter((l) => inPeriod(l.created_at)));

  // ---- Tech hours (from the time clock, live since 2026-11-05) ----
  const staffName = new Map((staffRes.data ?? []).map((s) => [s.id, s.name || s.email || "Unnamed"]));
  const hoursByStaff = new Map<string, { work: number; drive: number }>();
  for (const e of entriesRes.data ?? []) {
    if (!e.ended_at || e.voided_at || !inPeriod(e.started_at)) continue;
    const row = hoursByStaff.get(e.staff_id) ?? { work: 0, drive: 0 };
    const h = (new Date(e.ended_at).getTime() - new Date(e.started_at).getTime()) / 3_600_000;
    if (e.kind === "drive") row.drive += h;
    else row.work += h;
    hoursByStaff.set(e.staff_id, row);
  }

  const periodLabel = months === null ? "All time" : months === 3 ? "Last 3 months" : "Last 12 months";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className={headingClass}>Reports</h1>
          <p className={subTextClass}>
            {periodLabel}. Owner only. Months and days are New York time.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PERIODS) as PeriodKey[]).map((key) => (
            <Link
              key={key}
              href={`/analytics?period=${key}`}
              className={`${buttonSecondaryClass} ${key === period ? "border-gold text-gold" : ""}`}
            >
              {key === "all" ? "All time" : `${key} months`}
            </Link>
          ))}
        </div>
        {loadError && <p className="text-sm text-accent">Some report data didn&apos;t load. Refresh to try again.</p>}
      </div>

      {/* Profit per job */}
      <section className="flex flex-col gap-2">
        <h2 className={sectionTitle}>Profit per finished job</h2>
        <p className={itemSubClass}>
          Price is the job&apos;s contract or estimate (the option the customer picked), or its own invoices when
          there is none. Parts cost comes from the cost on each line. Labor is clocked hours
          {hourlyRate !== null ? ` at ${money(hourlyRate)}/hr` : ""}. Missing pieces are named, never counted as $0.
        </p>
        {hourlyRate === null && (
          <p className="text-sm text-accent">HOURLY_LABOR_RATE is not set on Vercel, so labor is left out.</p>
        )}
        {priced.length > 0 && (
          <div className={`${cardClass} flex flex-wrap gap-6`}>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-g300">Jobs with a price</div>
              <div className="font-display text-lg font-extrabold text-white">
                {priced.length} of {profitRows.length}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-g300">Price</div>
              <div className="font-display text-lg font-extrabold text-white">{money(totalPrice)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-g300">Profit</div>
              <div className="font-display text-lg font-extrabold text-gold">{money(totalProfit)}</div>
            </div>
          </div>
        )}
        <div className="flex flex-col divide-y divide-white/8">
          {profitRows.length === 0 && <p className={subTextClass}>No finished jobs in this period.</p>}
          {profitRows.map((row) => (
            <div key={row.job.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div>
                <div className={itemTitleClass}>
                  {one(row.job.customers)?.name ?? "No customer"}{" "}
                  <span className={itemSubClass}>· {row.job.job_type ?? "job"}</span>
                </div>
                <div className={itemSubClass}>
                  Finished {row.job.completed_at ? formatEtDateTime(row.job.completed_at) : "—"}
                  {row.hours !== null ? ` · ${row.hours} h` : ""}
                  {row.collected > 0 ? ` · collected ${money(row.collected)}` : ""}
                </div>
                {row.gaps.length > 0 && <div className="text-xs text-accent">{row.gaps.join(" · ")}</div>}
              </div>
              <div className="text-right font-mono text-sm">
                <div className="text-white">
                  {money(row.price)} <span className="text-g300">price</span>
                </div>
                <div className="text-g300">
                  − {money(row.parts)} parts − {money(row.labor)} labor
                </div>
                <div className="text-gold">
                  {money(row.profit)}
                  {row.margin !== null ? ` (${row.margin}%)` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Revenue by service type */}
      <section className="flex flex-col gap-2">
        <h2 className={sectionTitle}>Paid revenue by service type</h2>
        <p className={itemSubClass}>
          CRM documents marked paid ({money(paidTotal)}). Square history is not included. Money not tied to a job shows
          as &ldquo;{NOT_LINKED}&rdquo;.
        </p>
        <div className="flex flex-col divide-y divide-white/8">
          {byType.length === 0 && <p className={subTextClass}>Nothing paid in this period.</p>}
          {byType.map((row) => (
            <div key={row.type} className="flex items-center justify-between py-3">
              <div className={itemTitleClass}>
                {row.type} <span className={itemSubClass}>({row.count})</span>
              </div>
              <div className="font-mono text-sm text-white">{money(row.total)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Revenue by month */}
      <section className="flex flex-col gap-2">
        <h2 className={sectionTitle}>Paid revenue by month</h2>
        <div className="flex flex-col divide-y divide-white/8">
          {sortedMonths.length === 0 && <p className={subTextClass}>Nothing paid in this period.</p>}
          {sortedMonths.map(([key, total]) => (
            <div key={key} className="flex items-center justify-between py-3">
              <div className={itemTitleClass}>{monthLabel(key)}</div>
              <div className="font-mono text-sm text-white">{money(total)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Lead sources */}
      <section className="flex flex-col gap-2">
        <h2 className={sectionTitle}>Lead sources</h2>
        <p className={itemSubClass}>Leads added in this period, by where they came from and the stage they are at now.</p>
        <div className="overflow-x-auto">
          {leadRows.length === 0 ? (
            <p className={subTextClass}>No leads in this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/8 text-left text-xs uppercase tracking-wide text-g300">
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3 text-right">Leads</th>
                  {LEAD_REPORT_STAGES.map((s) => (
                    <th key={s} className="py-2 pr-3 text-right capitalize">
                      {s}
                    </th>
                  ))}
                  <th className="py-2 pr-3 text-right">Other</th>
                  <th className="py-2 text-right">Won</th>
                </tr>
              </thead>
              <tbody>
                {leadRows.map((row) => (
                  <tr key={row.source} className="border-b border-white/8 last:border-0">
                    <td className="py-2 pr-3 text-white">{row.source.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-3 text-right font-mono">{row.total}</td>
                    {LEAD_REPORT_STAGES.map((s) => (
                      <td key={s} className="py-2 pr-3 text-right font-mono text-g300">
                        {row.stages[s]}
                      </td>
                    ))}
                    <td className="py-2 pr-3 text-right font-mono text-g300">{row.stages.other}</td>
                    <td className="py-2 text-right font-mono text-gold">
                      {row.winRate === null ? "—" : `${row.winRate}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className={itemSubClass}>Won % is won out of leads marked won or lost. Other is dismissed or an old status.</p>
      </section>

      {/* Tech hours */}
      <section className="flex flex-col gap-2">
        <h2 className={sectionTitle}>Tech hours on jobs</h2>
        <p className={itemSubClass}>
          From job timers (the time clock started 2026-11-05, so older jobs have none). Weekly pay hours and the Gusto
          file are on <Link href="/hours" className="text-gold underline">Weekly hours</Link>.
        </p>
        <div className="flex flex-col divide-y divide-white/8">
          {hoursByStaff.size === 0 && <p className={subTextClass}>No job time clocked in this period.</p>}
          {[...hoursByStaff.entries()].map(([staffId, h]) => (
            <div key={staffId} className="flex items-center justify-between py-3">
              <div className={itemTitleClass}>{staffName.get(staffId) ?? "Unknown staff"}</div>
              <div className="font-mono text-sm text-white">
                {(Math.round(h.work * 10) / 10).toFixed(1)} h on site · {(Math.round(h.drive * 10) / 10).toFixed(1)} h
                driving
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
