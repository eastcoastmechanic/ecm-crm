import { supabase } from "@/lib/supabase";
import { resolveJobPhotos } from "@/lib/job-photos";
import { listOpenPlannerTasksSafe } from "@/lib/planner-connector";
import { createServiceCall } from "./actions";
import JobsView from "./JobsView";
import SubmitButton from "../SubmitButton";
import { buttonClass, errorClass, headingClass, subTextClass } from "../ui";

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
  const jobsWithPhotos = await Promise.all(
    (jobs ?? []).map(async (job) => ({
      ...job,
      photos: await resolveJobPhotos(job.photos),
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
        <form action={createServiceCall}>
          <SubmitButton className={buttonClass} pendingText="Creating…">
            + New Service Call
          </SubmitButton>
        </form>
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
