import { supabase } from "@/lib/supabase";
import type { ComponentProps } from "react";
import Link from "next/link";
import { resolveJobPhotoLists } from "@/lib/job-photos";
import { chunk, fetchAllRows, pageLimit } from "@/lib/fetch-all";
import { listOpenPlannerTasksSafe } from "@/lib/planner-connector";
import NewServiceCallForm from "./NewServiceCallForm";
import { balanceDueCents, formatMoney } from "@/lib/job-invoice-rules";
import JobsView from "./JobsView";
import { errorClass, headingClass, subTextClass } from "../ui";

const JOB_SELECT = "*, customers(id, name, no_followups), properties(address), diagnostics(id), install_reports(id)";
const CLOSED_STATUSES = ["complete", "completed", "cancelled", "canceled"];
const CLOSED_IN = `(${CLOSED_STATUSES.join(",")})`;
/** Finished/cancelled jobs shown per "Show older" step. Open jobs are always all shown. */
const FINISHED_STEP = 200;
const FINISHED_MAX = 5000;

// Rows from JOB_SELECT. Only the fields this page reads are typed; JobsView
// gets the full row, as it did when the query result was untyped.
type JobRow = Record<string, unknown> & { id: string; status: string; scheduled_at: string | null };

// Newest first, unscheduled at the top (same order as the old single query).
function byScheduledDesc(a: JobRow, b: JobRow) {
  if (!a.scheduled_at || !b.scheduled_at) return (a.scheduled_at ? 1 : 0) - (b.scheduled_at ? 1 : 0);
  return new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime();
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ finished?: string; view?: string }>;
}) {
  const params = await searchParams;
  const finishedLimit = pageLimit(params.finished, FINISHED_STEP, FINISHED_MAX);

  // Supabase stops at 1000 rows without saying so. Open jobs are paged so none
  // is ever dropped; finished and cancelled jobs show the newest few hundred,
  // with a link for older ones.
  const [openResult, finishedResult, finishedCount, plannerTasks, { data: staffRows }] = await Promise.all([
    fetchAllRows<JobRow>((from, to) =>
      supabase
        .from("jobs")
        .select(JOB_SELECT)
        .or(`status.is.null,status.not.in.${CLOSED_IN}`)
        .order("scheduled_at", { ascending: false })
        .order("id")
        .range(from, to)
    ),
    // Paged too: past 1000 a single .limit() would still stop at 1000.
    fetchAllRows<JobRow>(
      (from, to) =>
        supabase
          .from("jobs")
          .select(JOB_SELECT)
          .in("status", CLOSED_STATUSES)
          .order("scheduled_at", { ascending: false })
          .order("id")
          .range(from, Math.min(to, finishedLimit - 1)),
      { maxRows: finishedLimit }
    ),
    supabase.from("jobs").select("id", { count: "exact", head: true }).in("status", CLOSED_STATUSES),
    listOpenPlannerTasksSafe(),
    supabase.from("staff").select("id, name, email, role").order("name"),
  ]);
  const error = openResult.error
    ? { message: openResult.error }
    : finishedResult.error
      ? { message: finishedResult.error }
      : null;
  const finishedJobs = finishedResult.data.slice(0, finishedLimit);
  const finishedTotal = finishedCount.count ?? finishedJobs.length;
  const jobs = [...openResult.data, ...finishedJobs].sort(byScheduledDesc);
  const staff = (staffRows ?? []).map((s) => ({ id: s.id as string, name: (s.name as string | null) || (s.email as string) }));
  const tasks = plannerTasks.tasks.map((t) => ({ id: t.id, title: t.title, notes: t.notes, due_at: t.dueDateTime }));

  // Photos live in a private bucket, so the server signs them here rather than
  // handing the client a path it cannot fetch. Legacy public-URL entries pass
  // through untouched.
  // Ids go in the URL, so lookups by id run in chunks.
  const jobIds = jobs.map((j) => j.id);
  const invoiceChunks = await Promise.all(
    chunk(jobIds).map((ids) =>
      supabase.from("documents").select("id, job_id, doc_number, status, total").eq("type", "invoice").in("job_id", ids)
    )
  );
  const invoiceError = invoiceChunks.find((r) => r.error)?.error ?? null;
  const invoiceRows = invoiceChunks.flatMap((r) => r.data ?? []);
  // A linked Square invoice knows what is still due after a partial payment;
  // prefer that over the CRM total so the owed amount is not overstated.
  const docIds = invoiceRows.map((d) => d.id as string);
  const squareChunks = await Promise.all(
    chunk(docIds).map((ids) =>
      supabase.from("square_invoices").select("document_id, amount_due_cents").in("document_id", ids)
    )
  );
  const squareRows = squareChunks.flatMap((r) => r.data ?? []);
  const dueByDoc = new Map<string, number>();
  for (const r of squareRows ?? []) {
    if (r.document_id) dueByDoc.set(r.document_id as string, (dueByDoc.get(r.document_id as string) ?? 0) + (r.amount_due_cents ?? 0) / 100);
  }
  const billingByJob = new Map<string, { id: string; doc_number: string | null; status: string; total: number | null }[]>();
  for (const d of invoiceRows ?? []) {
    const list = billingByJob.get(d.job_id as string) ?? [];
    const due = dueByDoc.get(d.id as string);
    list.push({ id: d.id, doc_number: d.doc_number, status: d.status, total: due ?? d.total });
    billingByJob.set(d.job_id as string, list);
  }

  // Finished jobs with a contract and no invoice yet: suggest the balance (total less deposit received).
  // Only what the contract actually says is used. An unknown deposit is left out of the note, not guessed.
  const needInvoice = jobs.filter(
    (j) => j.status === "complete" && j.document_id && !(billingByJob.get(j.id) ?? []).length
  );
  const contractIds = [...new Set(needInvoice.map((j) => j.document_id as string))];
  const contractChunks = await Promise.all(
    chunk(contractIds).map((ids) =>
      supabase
        .from("documents")
        .select("id, doc_number, type, total, deposit_received_cents")
        .eq("type", "contract")
        .in("id", ids)
    )
  );
  const contractById = new Map(contractChunks.flatMap((r) => r.data ?? []).map((c) => [c.id as string, c]));
  function invoiceHintFor(job: { id: unknown; document_id?: unknown }) {
    const c = job.document_id ? contractById.get(job.document_id as string) : undefined;
    if (!c || c.total == null) return undefined;
    const totalCents = Math.round(Number(c.total) * 100);
    const dep = (c.deposit_received_cents as number | null) ?? null;
    const balance = balanceDueCents(totalCents, dep);
    return {
      suggested: (balance / 100).toFixed(2),
      note:
        dep == null
          ? `Contract ${c.doc_number ?? ""} total ${formatMoney(totalCents)}. No deposit is recorded, so the full amount is filled in. Fix it if a deposit came in.`
          : `Contract ${c.doc_number ?? ""} total ${formatMoney(totalCents)} less deposit received ${formatMoney(dep)}.`,
    };
  }

  // One signing call for every job's photos, not one per job.
  const signedPhotos = await resolveJobPhotoLists(jobs.map((job) => job.photos));
  const jobsWithPhotos = jobs.map((job, i) => ({
    ...job,
    photos: signedPhotos[i],
    invoices: invoiceError ? undefined : (billingByJob.get(job.id) ?? []),
    invoiceHint: invoiceHintFor(job),
  }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Jobs</h1>
          <p className={subTextClass}>
            Scheduled service and installs, including requests submitted through the customer portal.
          </p>
        </div>
        <NewServiceCallForm />
      </div>

      {error && <p className={errorClass}>Error loading jobs: {error.message}</p>}

      <JobsView
        jobs={jobsWithPhotos as unknown as ComponentProps<typeof JobsView>["jobs"]}
        tasks={tasks ?? []}
        staff={staff}
        hourlyRate={Number(process.env.HOURLY_LABOR_RATE) || null}
        initialView={params.view === "list" ? "list" : "calendar"}
      />

      {finishedTotal > finishedJobs.length && (
        <p className={subTextClass}>
          Showing all open jobs and the newest {finishedJobs.length} of {finishedTotal} finished or cancelled jobs.{" "}
          {finishedLimit < FINISHED_MAX && (
            <Link href={`/jobs?finished=${finishedLimit + FINISHED_STEP}`} className="font-semibold text-accent">
              Show older
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
