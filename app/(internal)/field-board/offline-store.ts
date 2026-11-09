import { useSyncExternalStore } from "react";
import {
  enqueue,
  keepRefused,
  markFailed,
  markRefused,
  newQueuedAction,
  nextToSend,
  removeItem,
  retryItem,
  type OfflineActionType,
  type QueuedAction,
} from "@/lib/offline-queue";

// The truck screen's queue on the phone. Every tap (On my way, I'm here, Finish, job note)
// is saved here first and then sent to /field-board/sync: right away with signal, or when
// signal comes back (online event, app back in front, every 30 seconds). Saved in IndexedDB
// so it survives the app being closed; every IndexedDB call is wrapped, and if storage is
// blocked the queue still works while the screen stays open.
// Ordering and retry rules: lib/offline-queue.ts.

const DB_NAME = "ecm-truck";
const STORE = "queue";
const SYNC_URL = "/field-board/sync";
const SEND_TIMEOUT_MS = 20_000;

export type OfflineSnapshot = {
  items: QueuedAction[];
  /** Sent but the page has not reloaded yet, so the card does not flash back a step. */
  sent: QueuedAction[];
  /** Bumped after each send, so an open notebook reloads its notes. */
  sentVersion: number;
  loaded: boolean;
  online: boolean;
  syncing: boolean;
  /** False when this phone won't let us save (private mode, storage blocked). */
  storageOk: boolean;
  /** Signed out while updates were waiting. */
  needsSignIn: boolean;
  /** A tap made with signal that the server refused: shown once on the card, not kept. */
  flash: Record<string, string>;
  staffKey: string;
  /** When the page on screen was made, if it is the copy saved for offline use (else null). */
  savedCopyFrom: string | null;
};

const SERVER_SNAPSHOT: OfflineSnapshot = {
  items: [],
  sent: [],
  sentVersion: 0,
  loaded: false,
  online: true,
  syncing: false,
  storageOk: true,
  needsSignIn: false,
  flash: {},
  staffKey: "none",
  savedCopyFrom: null,
};

let state: OfflineSnapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();
let onSynced: (() => void) | null = null;

function setState(patch: Partial<OfflineSnapshot>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read the queue in a component. */
export function useOfflineQueue(): OfflineSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_SNAPSHOT
  );
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// ---------- IndexedDB (every call wrapped; null means storage is not available) ----------

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: "clientActionId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function db(): Promise<IDBDatabase | null> {
  dbPromise ??= openDb();
  return dbPromise;
}

async function idbRun(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest | void): Promise<unknown> {
  const database = await db();
  if (!database) throw new Error("no storage");
  return new Promise((resolve, reject) => {
    try {
      const tx = database.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function persist(prev: QueuedAction[], next: QueuedAction[]) {
  const nextIds = new Set(next.map((i) => i.clientActionId));
  const changed = next.filter((item) => !prev.includes(item));
  const removed = prev.filter((item) => !nextIds.has(item.clientActionId));
  if (changed.length === 0 && removed.length === 0) return;
  try {
    await idbRun("readwrite", (store) => {
      for (const item of changed) store.put(item);
      for (const item of removed) store.delete(item.clientActionId);
    });
  } catch {
    if (state.storageOk) setState({ storageOk: false });
  }
}

async function update(next: QueuedAction[]) {
  const prev = state.items;
  setState({ items: next });
  await persist(prev, next);
}

// ---------- Setup, called once by OfflineSync on the truck screen ----------

let loading: Promise<void> | null = null;

export function configureOfflineQueue(opts: { staffKey: string; onSynced: () => void }) {
  onSynced = opts.onSynced;
  if (state.staffKey !== opts.staffKey) setState({ staffKey: opts.staffKey });
  setState({ online: !isOffline() });
  loading ??= (async () => {
    let stored: QueuedAction[] = [];
    try {
      stored = ((await idbRun("readonly", (store) => store.getAll())) as QueuedAction[]) ?? [];
    } catch {
      setState({ storageOk: false });
    }
    // Anything tapped before storage finished loading stays too.
    const ids = new Set(state.items.map((i) => i.clientActionId));
    const merged = [...state.items];
    for (const item of stored) if (!ids.has(item.clientActionId)) merged.push(item);
    setState({ items: merged, loaded: true });
  })();
  return loading;
}

/** The page on screen is the saved offline copy made at `renderedAt` (or null: it is fresh). */
export function markRendered(savedCopyFrom: string | null) {
  if (state.savedCopyFrom !== savedCopyFrom) setState({ savedCopyFrom });
}

export function setOnline(online: boolean) {
  if (state.online !== online) setState({ online });
}

/** After the page reloaded with fresh data, the sent steps are in the server's numbers. */
export function clearSent() {
  if (state.sent.length) setState({ sent: [] });
}

// ---------- Taps ----------

function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // fall through
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Save a tap on the phone and try to send it now. */
export async function queueTap(type: OfflineActionType, jobId: string, payload?: { body?: string }) {
  if (state.flash[jobId]) {
    const flash = { ...state.flash };
    delete flash[jobId];
    setState({ flash });
  }
  const item = newQueuedAction({
    clientActionId: uuid(),
    type,
    jobId,
    payload,
    createdAt: new Date().toISOString(),
    staffKey: state.staffKey,
  });
  if (isOffline()) item.savedOffline = true;
  await update(enqueue(state.items, item));
  void flushQueue(true);
}

export async function retryTap(id: string) {
  await update(retryItem(state.items, id));
  void flushQueue(true);
}

export async function removeTap(id: string) {
  await update(removeItem(state.items, id));
}

/** Updates saved under another sign-in on this phone: they can't be sent as this person. */
export async function discardOtherSignIns() {
  await update(state.items.filter((i) => i.staffKey === state.staffKey));
}

// ---------- Sending ----------

type Outcome =
  | { kind: "ok" }
  | { kind: "refused"; error: string }
  /** The server had a problem; try later. */
  | { kind: "retry" }
  /** Never reached the server (no signal, or a phone that says it is online but isn't). */
  | { kind: "network" }
  | { kind: "signin" };

async function send(item: QueuedAction): Promise<Outcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(SYNC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientActionId: item.clientActionId,
        type: item.type,
        jobId: item.jobId,
        createdAt: item.createdAt,
        payload: item.payload,
      }),
      credentials: "same-origin",
      cache: "no-store",
      // A signed-out phone gets a redirect to the login page; don't follow it.
      redirect: "manual",
      signal: controller.signal,
    });
    if (res.type === "opaqueredirect" || res.status === 401) return { kind: "signin" };
    if (res.status >= 500 || res.status === 429 || res.status === 408) return { kind: "retry" };
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!data) return { kind: "retry" };
    if (data.ok) return { kind: "ok" };
    return { kind: "refused", error: data.error || "Couldn't save this." };
  } catch {
    // No signal, timed out, or the connection dropped mid-send. The server ignores a repeat.
    return { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every 30 seconds. After a send failed with the phone still saying it is online, there is no
 * "online" event to wait for, so check again straight away instead of waiting out the backoff.
 */
export function tick() {
  if (!state.online && !isOffline()) {
    setState({ online: true });
    void flushQueue(true);
    return;
  }
  void flushQueue(false);
}

let flushing = false;
let flushAgain = false;

/** Send what is waiting, oldest first. `force` ignores the retry wait (signal just came back). */
export async function flushQueue(force = false): Promise<void> {
  if (flushing) {
    flushAgain = true;
    return;
  }
  flushing = true;
  let sentAny = false;
  setState({ syncing: true });
  try {
    for (;;) {
      if (isOffline()) {
        setState({ online: false });
        // Mark what is waiting as saved on the phone, so a refusal later is kept and shown.
        const unmarked = state.items.filter((i) => !i.savedOffline && i.state === "pending");
        if (unmarked.length) await update(state.items.map((i) => (unmarked.includes(i) ? { ...i, savedOffline: true } : i)));
        break;
      }
      const item = nextToSend(state.items, Date.now(), state.staffKey, force);
      if (!item) break;
      const outcome = await send(item);
      if (outcome.kind === "ok") {
        sentAny = true;
        setState({ sent: [...state.sent, item], sentVersion: state.sentVersion + 1, needsSignIn: false, online: true });
        await update(removeItem(state.items, item.clientActionId));
      } else if (outcome.kind === "refused") {
        if (keepRefused(item)) {
          await update(markRefused(state.items, item.clientActionId, outcome.error));
        } else {
          await update(removeItem(state.items, item.clientActionId));
          setState({ flash: { ...state.flash, [item.jobId]: outcome.error } });
        }
      } else {
        await update(markFailed(state.items, item.clientActionId, Date.now()));
        if (outcome.kind === "signin") setState({ needsSignIn: true });
        if (outcome.kind === "network") setState({ online: false });
        break;
      }
    }
  } finally {
    flushing = false;
    setState({ syncing: false });
  }
  if (sentAny) onSynced?.();
  if (flushAgain) {
    flushAgain = false;
    void flushQueue(force);
  }
}
