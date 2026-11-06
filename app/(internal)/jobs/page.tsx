import { supabase } from "@/lib/supabase";
import { resolveJobPhotos } from "@/lib/job-photos";
import { listOpenPlannerTasksSafe } from "@/lib/planner-connector";
import NewServiceCallForm from "./NewServiceCallForm";
import { balanceDueCents, formatMoney } from "@/lib/job-invoice-rules";
import JobsView from "./JobsView";
import { errorClass, headingClass, subTextClass } from "../ui";

export default async function JobsPage() {
  const [{ data: jobs, error }, plannerTasks, { data: staffRows }] = await Promise.all([
    supabase
      .from("jobs")
      .select("*, customers(id, name), properties(address), diagnostics(id), install_reports(id)")
      .order("scheduled_at", { ascending: false }),
    listOpenPlannerTasksSafe(),
    supabase.from("staff").select("id, name, email, role").order("name"),
  ]);
  const staff = (staffRows ?? []).map((s) => ({ id: s.id as string, name: (s.name as string | null) || (s.email as string) }));
  const tasks = plannerTasks.tasks.map((t) => ({ id: t.id, title: t.title, notes: t.notes, due_at: t.dueDateTime }));

  // Photos live in a private bucket, so the server signs them here rather than
  // handing the client a path it cannot fetch. Legacy public-URL entries pass
  // through untouched.
  const jobIds = (jobs ?? []).map((j) => j.id as string);
  const { data: invoiceRows, error: invoiceError } = jobIds.length
    ? await supabase
        .from("documents")
        .select("id, job_id, doc_number, status, total")
        .eq("type", "invoice")
        .in("job_id", jobIds)
    : { data: [], error: null };
  // A linked Square invoice knows what is still due after a partial payment;
  // prefer that over the CRM total so the owed amount is not overstated.
  const docIds = (invoiceRows ?? []).map((d) => d.id as string);
  const { data: squareRows } = docIds.length
    ? await supabase.from("square_invoices").select("document_id, amount_due_cents").in("document_id", docIds)
    : { data: [] };
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
  const needInvoice = (jobs ?? []).filter(
    (j) => j.status === "complete" && j.document_id && !(billingByJob.get(j.id as string) ?? []).length
  );
  const contractIds = [...new Set(needInvoice.map((j) => j.document_id as string))];
  const { data: contractRows } = contractIds.length
    ? await supabase
        .from("documents")
        .select("id, doc_number, type, total, deposit_received_cents")
        .eq("type", "contract")
        .in("id", contractIds)
    : { data: [] };
  const contractById = new Map((contractRows ?? []).map((c) => [c.id as string, c]));
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

  const jobsWithPhotos = await Promise.all(
    (jobs ?? []).map(async (job) => ({
      ...job,
      photos: await resolveJobPhotos(job.photos),
      invoices: invoiceError ? undefined : (billingByJob.get(job.id as string) ?? []),
      invoiceHint: invoiceHintFor(job),
    }))
  );

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
        jobs={jobsWithPhotos}
        tasks={tasks ?? []}
        staff={staff}
        hourlyRate={Number(process.env.HOURLY_LABOR_RATE) || null}
      />
    </div>
  );
}
