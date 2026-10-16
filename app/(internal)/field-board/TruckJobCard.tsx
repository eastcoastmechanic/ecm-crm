import SubmitButton from "../SubmitButton";
import { truckOnMyWay, truckSetStatus } from "./actions";

export type TruckJob = {
  id: string;
  status: string;
  scheduled_at: string | null;
  notes: string | null;
  job_type: string | null;
  on_way_at: string | null;
  customer: string | null;
  phone: string | null;
  address: string | null;
};

const bigButton =
  "w-full rounded-xl bg-gradient-to-br from-accent to-accent-2 px-4 py-4 text-base font-bold uppercase tracking-wide text-white shadow-[0_2px_8px_rgba(232,80,42,.3)] transition-opacity hover:opacity-90";

const linkButton =
  "flex flex-1 items-center justify-center rounded-xl border border-white/8 bg-white/4 px-4 py-3 text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-white/8";

function timeLabel(value: string | null) {
  if (!value) return "Unscheduled";
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

// One step at a time: On my way -> I'm here -> Finish job.
function StepButton({ job }: { job: TruckJob }) {
  if (job.status === "in_progress") {
    return (
      <form action={truckSetStatus}>
        <input type="hidden" name="id" value={job.id} />
        <input type="hidden" name="status" value="complete" />
        <SubmitButton className={bigButton} pendingText="Saving…">
          Finish job
        </SubmitButton>
      </form>
    );
  }
  if (job.on_way_at) {
    return (
      <form action={truckSetStatus}>
        <input type="hidden" name="id" value={job.id} />
        <input type="hidden" name="status" value="in_progress" />
        <SubmitButton className={bigButton} pendingText="Saving…">
          I&apos;m here
        </SubmitButton>
      </form>
    );
  }
  return (
    <form action={truckOnMyWay}>
      <input type="hidden" name="id" value={job.id} />
      <SubmitButton className={bigButton} pendingText="Sending…">
        On my way
      </SubmitButton>
    </form>
  );
}

function stateLabel(job: TruckJob) {
  if (job.status === "in_progress") return "On site";
  if (job.on_way_at) return "On the way";
  return job.status.replaceAll("_", " ");
}

export default function TruckJobCard({ job, primary = false }: { job: TruckJob; primary?: boolean }) {
  const tel = job.phone ? job.phone.replace(/[^\d+]/g, "") : "";
  const maps = job.address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address)}`
    : null;

  return (
    <div
      className={`rounded-2xl border p-4 ${
        primary ? "border-accent/50 bg-accent/5" : "border-white/8 bg-white/3"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-xs font-bold uppercase tracking-wide text-g300">
          {timeLabel(job.scheduled_at)}
          {job.job_type ? ` · ${job.job_type.replaceAll("_", " ")}` : ""}
        </div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-accent">{stateLabel(job)}</div>
      </div>
      <div className={`mt-1 font-display font-bold text-white ${primary ? "text-2xl" : "text-lg"}`}>
        {job.customer ?? "Job"}
      </div>
      <p className="text-sm text-g300">{job.address ?? "No address on this job"}</p>
      {primary && job.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-g300">{job.notes}</p>}

      {(maps || tel) && (
        <div className="mt-3 flex gap-2">
          {maps && (
            <a href={maps} target="_blank" rel="noreferrer" className={linkButton}>
              Maps
            </a>
          )}
          {tel && (
            <a href={`tel:${tel}`} className={linkButton}>
              Call
            </a>
          )}
        </div>
      )}

      <div className="mt-3">
        <StepButton job={job} />
      </div>
    </div>
  );
}
