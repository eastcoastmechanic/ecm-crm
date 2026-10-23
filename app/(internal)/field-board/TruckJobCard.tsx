import SubmitButton from "../SubmitButton";
import PhotoButtons, { type PhotoCounts } from "./PhotoButtons";
import { truckOnMyWay, truckSetStatus } from "./actions";
import { formatEtTime } from "@/lib/tz";
import OnSiteLine from "./OnSiteLine";

export function OnSite({ job }: { job: TruckJob }) {
  if (!job.arrived_at || (job.status !== "in_progress" && job.status !== "complete")) return null;
  return (
    <p className="mt-1 text-sm font-semibold text-white">
      <OnSiteLine
        arrivedAt={job.arrived_at}
        completedAt={job.completed_at ?? null}
        status={job.status}
        sinceLabel={formatEtTime(job.arrived_at)}
      />
    </p>
  );
}

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
  photoCounts: PhotoCounts;
  assignedToMe?: boolean;
  arrived_at?: string | null;
  completed_at?: string | null;
  reportId?: string | null;
  accessNotes?: string | null;
  customerNotes?: string | null;
  equipment?: { type: string | null; brand: string | null; model: string | null; serial: string | null; installDate: string | null }[];
  lastVisit?: string | null;
};

function SiteInfo({ job }: { job: TruckJob }) {
  const equipment = job.equipment ?? [];
  if (!job.accessNotes && !job.customerNotes && equipment.length === 0 && !job.lastVisit) return null;
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl border border-white/8 bg-white/3 p-3 text-sm">
      {job.accessNotes && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-accent">Access</div>
          <p className="whitespace-pre-wrap text-white">{job.accessNotes}</p>
        </div>
      )}
      {job.customerNotes && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-g300">Customer notes</div>
          <p className="whitespace-pre-wrap text-g300">{job.customerNotes}</p>
        </div>
      )}
      {equipment.length > 0 && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-g300">Equipment on file</div>
          <ul className="mt-1 flex flex-col gap-1 text-g300">
            {equipment.map((e, i) => (
              <li key={i}>
                {[e.type, e.brand, e.model].filter(Boolean).join(" · ") || "Unit"}
                {e.serial ? ` · S/N ${e.serial}` : ""}
                {e.installDate ? ` · installed ${e.installDate}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {job.lastVisit && (
        <div className="text-g300">
          Last visit:{" "}
          {new Date(job.lastVisit).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" })}
        </div>
      )}
    </div>
  );
}

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
        {job.assignedToMe && (
          <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-accent">
            Yours
          </span>
        )}
      </div>
      <p className="text-sm text-g300">{job.address ?? "No address on this job"}</p>
      <OnSite job={job} />
      {primary && job.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-g300">{job.notes}</p>}
      {primary ? (
        <SiteInfo job={job} />
      ) : (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-g300">Site info</summary>
          <SiteInfo job={job} />
        </details>
      )}

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

      {(primary || job.status === "in_progress") && (
        <div className="mt-3 flex gap-2">
          <a
            href={job.reportId ? `/diagnostics/${job.reportId}` : `/diagnostics/new?job_id=${job.id}`}
            className={linkButton}
          >
            {job.reportId ? "Service report" : "Start service report"}
          </a>
        </div>
      )}

      {(primary || job.status === "in_progress") && (
        <div className="mt-3">
          <PhotoButtons jobId={job.id} counts={job.photoCounts} />
        </div>
      )}

      <div className="mt-3">
        <StepButton job={job} />
      </div>
    </div>
  );
}
