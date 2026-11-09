import { describe, expect, it } from "vitest";
import {
  backoffMs,
  effectiveStep,
  enqueue,
  keepRefused,
  markFailed,
  markRefused,
  newQueuedAction,
  nextToSend,
  removeItem,
  retryItem,
  serverStep,
  sortQueue,
  type OfflineActionType,
  type QueuedAction,
} from "../offline-queue";

const JOB_A = "aaaaaaaa-0000-4000-8000-000000000001";
const JOB_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ME = "staff-1";

let n = 0;
function tap(type: OfflineActionType, jobId: string, minute: number, extra: Partial<QueuedAction> = {}): QueuedAction {
  n += 1;
  return {
    ...newQueuedAction({
      clientActionId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      type,
      jobId,
      payload: type === "note" ? { body: `note ${n}` } : {},
      createdAt: new Date(Date.UTC(2026, 10, 9, 14, minute)).toISOString(),
      staffKey: ME,
    }),
    ...extra,
  };
}

describe("enqueue", () => {
  it("keeps taps in the order they were made, whatever order they arrive in", () => {
    const late = tap("arrive", JOB_A, 20);
    const early = tap("on_way", JOB_A, 5);
    const queue = enqueue(enqueue([], late), early);
    expect(queue.map((q) => q.type)).toEqual(["on_way", "arrive"]);
  });

  it("never adds the same clientActionId twice", () => {
    const item = tap("note", JOB_A, 1);
    expect(enqueue(enqueue([], item), { ...item })).toHaveLength(1);
  });

  it("drops a double tap of the same step on the same job", () => {
    const first = tap("arrive", JOB_A, 1);
    const second = tap("arrive", JOB_A, 2);
    expect(enqueue([first], second)).toEqual([first]);
  });

  it("keeps two different notes on the same job", () => {
    expect(enqueue([tap("note", JOB_A, 1)], tap("note", JOB_A, 2))).toHaveLength(2);
  });

  it("tapping a refused step again retries it instead of adding a copy", () => {
    const refused = { ...tap("finish", JOB_A, 1), state: "refused" as const, error: "Checklist", attempts: 3, nextAttemptAt: 999 };
    const queue = enqueue([refused], tap("finish", JOB_A, 5));
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ clientActionId: refused.clientActionId, state: "pending", attempts: 0, nextAttemptAt: 0 });
    expect(queue[0].error).toBeUndefined();
  });

  it("sorts ties by id so the order is stable", () => {
    const a = tap("note", JOB_A, 1);
    const b = { ...tap("note", JOB_A, 1) };
    expect(sortQueue([b, a]).map((q) => q.clientActionId)).toEqual([a.clientActionId, b.clientActionId]);
  });
});

describe("nextToSend", () => {
  const now = Date.UTC(2026, 10, 9, 15, 0);

  it("sends the oldest first", () => {
    const queue = sortQueue([tap("arrive", JOB_A, 10), tap("on_way", JOB_A, 2), tap("note", JOB_B, 1)]);
    expect(nextToSend(queue, now, ME)?.type).toBe("note");
    expect(nextToSend(removeItem(queue, queue[0].clientActionId), now, ME)?.type).toBe("on_way");
  });

  it("a step waiting on backoff holds back the later steps on that job, not other jobs", () => {
    const waiting = { ...tap("on_way", JOB_A, 1), attempts: 1, nextAttemptAt: now + 30_000 };
    const queue = [waiting, tap("arrive", JOB_A, 2), tap("on_way", JOB_B, 3)];
    const next = nextToSend(queue, now, ME);
    expect(next?.jobId).toBe(JOB_B);
  });

  it("force ignores backoff (signal just came back)", () => {
    const waiting = { ...tap("on_way", JOB_A, 1), attempts: 4, nextAttemptAt: now + 120_000 };
    expect(nextToSend([waiting], now, ME)).toBeNull();
    expect(nextToSend([waiting], now, ME, true)?.clientActionId).toBe(waiting.clientActionId);
  });

  it("a refused Finish holds later steps but not a note written after it", () => {
    const finish = { ...tap("finish", JOB_A, 1), state: "refused" as const, error: "Checklist" };
    const later = tap("on_way", JOB_A, 2);
    const note = tap("note", JOB_A, 3);
    expect(nextToSend([finish, later, note], now, ME)?.clientActionId).toBe(note.clientActionId);
    expect(nextToSend([finish, later], now, ME, true)).toBeNull();
  });

  it("never sends an update saved under another sign-in", () => {
    expect(nextToSend([{ ...tap("note", JOB_A, 1), staffKey: "someone-else" }], now, ME)).toBeNull();
  });
});

describe("retry and backoff", () => {
  it("backs off 30s, 60s, 120s... and caps at 5 minutes", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(backoffMs)).toEqual([0, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
  });

  it("a failed send counts the try, waits, and marks it saved on the phone", () => {
    const item = tap("arrive", JOB_A, 1);
    const [failed] = markFailed([item], item.clientActionId, 1000);
    expect(failed).toMatchObject({ attempts: 1, nextAttemptAt: 31_000, savedOffline: true, state: "pending" });
    const [twice] = markFailed([failed], item.clientActionId, 2000);
    expect(twice).toMatchObject({ attempts: 2, nextAttemptAt: 62_000 });
  });

  it("refused keeps the reason; Try again clears it", () => {
    const item = tap("finish", JOB_A, 1);
    const [refused] = markRefused([item], item.clientActionId, "Tick the checklist.");
    expect(refused).toMatchObject({ state: "refused", error: "Tick the checklist." });
    expect(retryItem([refused], item.clientActionId)[0]).toMatchObject({ state: "pending", attempts: 0, nextAttemptAt: 0 });
  });

  it("a refusal is kept on the card only for a tap that waited on the phone", () => {
    expect(keepRefused(tap("finish", JOB_A, 1))).toBe(false);
    expect(keepRefused({ ...tap("finish", JOB_A, 1), savedOffline: true })).toBe(true);
  });
});

describe("card step", () => {
  it("follows the server when nothing is waiting", () => {
    expect(serverStep({ status: "scheduled", on_way_at: null })).toBe("on_way");
    expect(serverStep({ status: "scheduled", on_way_at: "2026-11-09T14:00:00Z" })).toBe("arrive");
    expect(serverStep({ status: "in_progress", on_way_at: null })).toBe("finish");
    expect(serverStep({ status: "complete", on_way_at: null })).toBe("done");
  });

  it("moves on for taps saved on the phone, never backwards, and ignores refused ones", () => {
    expect(effectiveStep("on_way", [{ type: "on_way" }])).toBe("arrive");
    expect(effectiveStep("on_way", [{ type: "on_way" }, { type: "arrive" }])).toBe("finish");
    expect(effectiveStep("finish", [{ type: "on_way" }])).toBe("finish");
    expect(effectiveStep("finish", [{ type: "finish", state: "refused" }])).toBe("finish");
    expect(effectiveStep("arrive", [{ type: "note" }])).toBe("arrive");
    expect(effectiveStep("finish", [{ type: "finish" }])).toBe("done");
  });
});
