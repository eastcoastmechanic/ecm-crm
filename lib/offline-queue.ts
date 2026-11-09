// Truck screen offline queue: pure rules, no browser APIs, so they are easy to test.
// The phone keeps taps (On my way, I'm here, Finish, a job note) in IndexedDB and sends
// them to /field-board/sync in the order they were made, one job at a time.
// Browser storage lives in app/(internal)/field-board/offline-store.ts.

export type OfflineActionType = "on_way" | "arrive" | "finish" | "note";

export type QueuedAction = {
  /** Made on the phone (uuid). The server uses it so a retry never applies twice. */
  clientActionId: string;
  type: OfflineActionType;
  jobId: string;
  payload: { body?: string };
  /** When the tech tapped, from the phone's clock (ISO). The server clamps it. */
  createdAt: string;
  /** Who was signed in when it was saved. Only that sign-in sends it. */
  staffKey: string;
  attempts: number;
  /** Epoch ms; not sent again before this (backoff after a failed send). */
  nextAttemptAt: number;
  /** pending = waiting to send. refused = the server said no (reason in error); kept until the tech retries or removes it. */
  state: "pending" | "refused";
  error?: string;
  /** True once a send failed for lack of signal, so a refusal later is shown, not dropped. */
  savedOffline?: boolean;
};

export const STATUS_TYPES: readonly OfflineActionType[] = ["on_way", "arrive", "finish"];
export const RETRY_EVERY_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/** Wait before the next try after `attempts` failed sends: 0, then 30s, 60s, 120s... capped at 5 min. */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(RETRY_EVERY_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

/** Oldest first; ties broken by id so the order is stable. */
export function sortQueue(queue: QueuedAction[]): QueuedAction[] {
  return [...queue].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.clientActionId.localeCompare(b.clientActionId)
  );
}

/**
 * Add a tap to the queue. The same clientActionId never goes in twice, and a second tap
 * of the same step on the same job (double tap while waiting) is dropped: it would do nothing.
 */
export function enqueue(queue: QueuedAction[], item: QueuedAction): QueuedAction[] {
  if (queue.some((q) => q.clientActionId === item.clientActionId)) return queue;
  if (STATUS_TYPES.includes(item.type)) {
    const same = queue.find((q) => q.jobId === item.jobId && q.type === item.type && q.staffKey === item.staffKey);
    // Tapping a refused step again means "try again now".
    if (same) return same.state === "refused" ? retryItem(queue, same.clientActionId) : queue;
  }
  return sortQueue([...queue, item]);
}

/**
 * The next item to send, or null. Per job, steps go strictly in order: a step waiting on
 * backoff or refused by the server holds back the steps behind it on that job. Notes do not
 * depend on the steps, so a refused Finish never strands a note written after it.
 * `force` ignores backoff (signal just came back, app opened).
 */
export function nextToSend(
  queue: QueuedAction[],
  now: number,
  staffKey: string,
  force = false
): QueuedAction | null {
  const stepBlocked = new Set<string>();
  const noteBlocked = new Set<string>();
  for (const item of sortQueue(queue)) {
    if (item.staffKey !== staffKey) continue;
    const isNote = item.type === "note";
    const blocked = isNote ? noteBlocked : stepBlocked;
    if (blocked.has(item.jobId)) continue;
    if (item.state === "refused") {
      // A refused step holds later steps; a refused note holds later notes.
      blocked.add(item.jobId);
      continue;
    }
    if (!force && item.nextAttemptAt > now) {
      blocked.add(item.jobId);
      continue;
    }
    return item;
  }
  return null;
}

export function removeItem(queue: QueuedAction[], id: string): QueuedAction[] {
  return queue.filter((q) => q.clientActionId !== id);
}

function patch(queue: QueuedAction[], id: string, change: (q: QueuedAction) => QueuedAction): QueuedAction[] {
  return queue.map((q) => (q.clientActionId === id ? change(q) : q));
}

/** No signal (or the server was down): try again later. */
export function markFailed(queue: QueuedAction[], id: string, now: number, error?: string): QueuedAction[] {
  return patch(queue, id, (q) => {
    const attempts = q.attempts + 1;
    return { ...q, attempts, nextAttemptAt: now + backoffMs(attempts), savedOffline: true, error };
  });
}

/** The server said no (Finish blocked by the checklist, job assigned to someone else...). */
export function markRefused(queue: QueuedAction[], id: string, error: string): QueuedAction[] {
  return patch(queue, id, (q) => ({ ...q, state: "refused", error }));
}

/** Tech pressed Try again: send it on the next pass. */
export function retryItem(queue: QueuedAction[], id: string): QueuedAction[] {
  return patch(queue, id, (q) => ({ ...q, state: "pending", attempts: 0, nextAttemptAt: 0, error: undefined }));
}

/** Items still on the phone for one job, oldest first. */
export function itemsForJob(queue: QueuedAction[], jobId: string): QueuedAction[] {
  return sortQueue(queue.filter((q) => q.jobId === jobId));
}

/**
 * Which step the card should show, given the step the server knows and what is saved on
 * the phone (or sent but not yet reloaded). Never goes backwards.
 */
export type TruckStepName = "on_way" | "arrive" | "finish" | "done";
const STEP_ORDER: TruckStepName[] = ["on_way", "arrive", "finish", "done"];

export function serverStep(job: { status: string; on_way_at: string | null }): TruckStepName {
  if (job.status === "complete" || job.status === "completed") return "done";
  if (job.status === "in_progress") return "finish";
  if (job.on_way_at) return "arrive";
  return "on_way";
}

export function effectiveStep(server: TruckStepName, local: { type: OfflineActionType; state?: QueuedAction["state"] }[]): TruckStepName {
  let step = STEP_ORDER.indexOf(server);
  for (const item of local) {
    if (item.state === "refused") continue;
    const after =
      item.type === "on_way" ? 1 : item.type === "arrive" ? 2 : item.type === "finish" ? 3 : -1;
    if (after > step) step = after;
  }
  return STEP_ORDER[step];
}

/** Server refusal on a tap made with signal: show it and drop it (the tech fixes it and taps again). */
export function keepRefused(item: QueuedAction): boolean {
  return Boolean(item.savedOffline);
}

export function newQueuedAction(input: {
  clientActionId: string;
  type: OfflineActionType;
  jobId: string;
  payload?: { body?: string };
  createdAt: string;
  staffKey: string;
}): QueuedAction {
  return {
    clientActionId: input.clientActionId,
    type: input.type,
    jobId: input.jobId,
    payload: input.payload ?? {},
    createdAt: input.createdAt,
    staffKey: input.staffKey,
    attempts: 0,
    nextAttemptAt: 0,
    state: "pending",
  };
}
