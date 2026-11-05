// Pure rules for the job checklist and the finish gate.

export type ChecklistItem = { id: string; label: string; required: boolean; done: boolean };

/** Minimum photos a job needs before a tech can finish it. */
export const MIN_PHOTOS_TO_FINISH = 1;

/**
 * Why a tech cannot finish the job yet. Empty means they can. An owner unlock on the job
 * lets it through. A job with no checklist items at all is gated on the photo only.
 */
export function finishBlockers(input: {
  items: ChecklistItem[];
  photoCount: number;
  unlocked: boolean;
}): string[] {
  if (input.unlocked) return [];
  const blockers: string[] = [];
  const open = input.items.filter((i) => i.required && !i.done);
  if (open.length > 0) {
    blockers.push(
      open.length === 1
        ? `Checklist item not done: ${open[0].label}`
        : `${open.length} checklist items not done, starting with: ${open[0].label}`
    );
  }
  if (input.photoCount < MIN_PHOTOS_TO_FINISH) blockers.push("Add at least one job photo.");
  return blockers;
}
