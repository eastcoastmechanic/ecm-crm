// Rules for taps the truck screen saved on the phone and sends later (/field-board/sync).
// Pure, so they are easy to test. The server side that applies them is lib/offline-sync.ts.

import type { OfflineActionType } from "@/lib/offline-queue";

export const MAX_TAP_AGE_MS = 24 * 3600_000;
export const MAX_NOTE_LENGTH = 4000;

/**
 * The time to record for a tap. The phone's time is used when it is a real time, not in
 * the future and at most 24 hours old; otherwise the server time. `floor` (for example the
 * job's arrival when stamping Finish) keeps the steps in order if the phone's clock is off.
 */
export function clampTapTime(tap: string | null | undefined, now: Date, floor?: string | null): string {
  const nowMs = now.getTime();
  const tapMs = tap ? Date.parse(tap) : NaN;
  let chosen = Number.isFinite(tapMs) && tapMs <= nowMs && nowMs - tapMs <= MAX_TAP_AGE_MS ? tapMs : nowMs;
  const floorMs = floor ? Date.parse(floor) : NaN;
  if (Number.isFinite(floorMs) && chosen < floorMs) chosen = Math.min(floorMs, nowMs);
  return new Date(chosen).toISOString();
}

export type SyncRequest = {
  clientActionId: string;
  type: OfflineActionType;
  jobId: string;
  createdAt: string | null;
  body?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES: OfflineActionType[] = ["on_way", "arrive", "finish", "note"];

/** Checks the JSON the phone sent. Returns the request or a plain error. */
export function parseSyncRequest(input: unknown): SyncRequest | { error: string } {
  if (!input || typeof input !== "object") return { error: "Bad request." };
  const raw = input as Record<string, unknown>;
  const clientActionId = typeof raw.clientActionId === "string" ? raw.clientActionId : "";
  const jobId = typeof raw.jobId === "string" ? raw.jobId : "";
  const type = raw.type as OfflineActionType;
  if (!UUID.test(clientActionId)) return { error: "Bad request." };
  if (!UUID.test(jobId)) return { error: "Missing job." };
  if (!TYPES.includes(type)) return { error: "Bad request." };
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : null;
  const payload = raw.payload && typeof raw.payload === "object" ? (raw.payload as Record<string, unknown>) : {};
  if (type === "note") {
    const body = typeof payload.body === "string" ? payload.body.trim() : "";
    if (!body) return { error: "Write a note first." };
    if (body.length > MAX_NOTE_LENGTH) return { error: `Keep it under ${MAX_NOTE_LENGTH} characters.` };
    return { clientActionId, type, jobId, createdAt, body };
  }
  return { clientActionId, type, jobId, createdAt };
}

/** Customers get "your tech is on the way" only if the tap is this fresh when it reaches us. */
export const ON_WAY_NOTICE_MAX_AGE_MS = 30 * 60_000;

export function shouldSendOnWayNotice(tapAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(tapAt) <= ON_WAY_NOTICE_MAX_AGE_MS;
}

const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

/** Before SQL 0076 the column is missing; the insert error names it. */
export function isMissingClientActionColumn(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return /client_action_id/i.test(error.message ?? "") || error.code === "42703" || error.code === "PGRST204";
}
