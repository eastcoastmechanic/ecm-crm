import { supabase } from "@/lib/supabase";
import JobsView from "./JobsView";
import { errorClass, headingClass, subTextClass } from "../ui";

export default async function JobsPage() {
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("*, customers(name), properties(address)")
    .order("scheduled_at", { ascending: false });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>Jobs</h1>
        <p className={subTextClass}>
          Scheduled service and installs, including requests submitted through the customer portal.
        </p>
      </div>

      {error && <p className={errorClass}>Error loading jobs: {error.message}</p>}

      <JobsView jobs={jobs ?? []} />
    </div>
  );
}
