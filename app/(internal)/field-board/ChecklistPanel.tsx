import SubmitButton from "../SubmitButton";
import { inputClass } from "../ui";
import { toggleChecklistItem, unlockChecklist } from "./checklist-actions";
import NeedsSignal from "./NeedsSignal";

export type TruckChecklistItem = { id: string; label: string; required: boolean; done: boolean };

const rowButton =
  "flex w-full items-start gap-3 rounded-xl border border-white/8 bg-white/4 px-3 py-3 text-left text-sm text-white transition-colors hover:bg-white/8";

/** The job checklist on the truck card. One tap per item. Owner gets an unlock when the job is stuck. */
export default function ChecklistPanel({
  jobId,
  items,
  blockers,
  unlocked,
  canUnlock,
}: {
  jobId: string;
  items: TruckChecklistItem[];
  blockers: string[];
  unlocked: boolean;
  canUnlock: boolean;
}) {
  if (items.length === 0 && blockers.length === 0 && !unlocked) return null;
  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="mt-3 rounded-xl border border-white/8 bg-white/3 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-[11px] font-bold uppercase tracking-wide text-g300">Checklist</div>
        {items.length > 0 && (
          <div className="text-xs text-g300">
            {doneCount} of {items.length}
          </div>
        )}
      </div>
      <NeedsSignal what="The checklist" className="flex flex-col gap-2">
        {items.map((item) => (
          <form key={item.id} action={toggleChecklistItem}>
            <input type="hidden" name="item_id" value={item.id} />
            <input type="hidden" name="done" value={item.done ? "false" : "true"} />
            <SubmitButton className={rowButton} pendingText="Saving…">
              <span aria-hidden>{item.done ? "☑" : "☐"}</span>
              <span className={item.done ? "text-g300 line-through" : ""}>
                {item.label}
                {!item.required && <span className="ml-1 text-xs text-g300">(optional)</span>}
              </span>
            </SubmitButton>
          </form>
        ))}
      </NeedsSignal>
      {unlocked && <p className="mt-2 text-xs text-g300">Unlocked by the owner. This job can be finished.</p>}
      {canUnlock && !unlocked && blockers.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-accent">Owner: unlock this job</summary>
          <form action={async (formData) => { "use server"; await unlockChecklist(formData); }} className="mt-2 grid gap-2">
            <input type="hidden" name="job_id" value={jobId} />
            <input name="reason" className={inputClass} placeholder="Why (broken phone, customer would not wait…)" required minLength={5} />
            <SubmitButton className={rowButton} pendingText="Unlocking…">
              Unlock so it can be finished
            </SubmitButton>
          </form>
        </details>
      )}
    </div>
  );
}
