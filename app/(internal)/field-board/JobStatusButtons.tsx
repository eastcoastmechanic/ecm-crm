import SubmitButton from "../SubmitButton";
import { buttonSecondaryClass } from "../ui";
import { setFieldJobStatus } from "./actions";

const NEXT: Record<string, { label: string; crm_status: string }[]> = {
  requested: [{ label: "On site", crm_status: "in_progress" }],
  scheduled: [{ label: "On site", crm_status: "in_progress" }],
  in_progress: [{ label: "Done", crm_status: "complete" }],
  complete: [],
  cancelled: [],
};

export default function JobStatusButtons({ jobId, status }: { jobId: string; status: string }) {
  const actions = NEXT[status] ?? [{ label: "On site", crm_status: "in_progress" }];
  if (actions.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.map((action) => (
        <form key={action.crm_status} action={setFieldJobStatus}>
          <input type="hidden" name="job_id" value={jobId} />
          <input type="hidden" name="crm_status" value={action.crm_status} />
          <SubmitButton className={buttonSecondaryClass} pendingText="Saving…">
            {action.label}
          </SubmitButton>
        </form>
      ))}
    </div>
  );
}
