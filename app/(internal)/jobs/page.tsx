import { supabase } from "@/lib/supabase";
import { createServiceCall } from "./actions";
import JobsView from "./JobsView";
import SubmitButton from "../SubmitButton";
import { buttonClass, errorClass, headingClass, subTextClass } from "../ui";

export default async function JobsPage() {
  const [{ data: jobs, error }, { data: tasks }] = await Promise.all([
    supabase
      .from("jobs")
      .select("*, customers(name), properties(address), diagnostics(id), install_reports(id)")
      .order("scheduled_at", { ascending: false }),
    supabase
      .from("tasks")
      .select("id, title, notes, due_at")
      .is("completed_at", null)
      .order("due_at", { ascending: true, nullsFirst: false }),
  ]);

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
        jobs={jobs ?? []}
        tasks={tasks ?? []}
        hourlyRate={Number(process.env.HOURLY_LABOR_RATE) || null}
      />
    </div>
  );
}
