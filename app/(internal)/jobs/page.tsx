import { supabase } from "@/lib/supabase";
import { updateJobStatus } from "./actions";
import { buttonClass, errorClass, headingClass, inputClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

const statusOptions = ["requested", "scheduled", "in_progress", "complete", "cancelled"];

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

      <div className="flex flex-col divide-y divide-white/8">
        {jobs?.length === 0 && <p className={subTextClass}>No jobs yet.</p>}
        {jobs?.map((job) => (
          <form
            key={job.id}
            action={updateJobStatus}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <input type="hidden" name="id" value={job.id} />
            <div>
              <div className={itemTitleClass}>
                {job.customers?.name ?? "Unknown customer"}
                {job.properties?.address ? ` — ${job.properties.address}` : ""}
              </div>
              <div className={itemSubClass}>
                {job.scheduled_at ? new Date(job.scheduled_at).toLocaleString() : "No date"}
                {job.notes ? ` · ${job.notes}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select name="status" defaultValue={job.status} className={inputClass}>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
              <button type="submit" className={buttonClass}>
                Save
              </button>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
