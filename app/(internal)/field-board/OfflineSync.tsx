"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RETRY_EVERY_MS } from "@/lib/offline-queue";
import {
  clearSent,
  configureOfflineQueue,
  discardOtherSignIns,
  flushQueue,
  markRendered,
  setOnline,
  tick,
  useOfflineQueue,
} from "./offline-store";

/** A page older than this when it opens came from the phone's saved copy, not the server. */
const STALE_PAGE_MS = 90_000;

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

/**
 * Mounted once on the truck screen. Runs the phone's queue (sends on signal back, app back in
 * front, and every 30 seconds while something waits) and shows the banner: how many updates
 * are waiting, and when the list on screen is the copy saved for offline use.
 */
export default function OfflineSync({ staffKey, renderedAt }: { staffKey: string; renderedAt: string }) {
  const router = useRouter();
  const queue = useOfflineQueue();
  const [refreshing, startRefresh] = useTransition();
  const wasRefreshing = useRef(false);
  const staleCopy = queue.savedCopyFrom !== null;

  useEffect(() => {
    // Opened from the saved copy (no signal at load): the page's own time is old.
    markRendered(Date.now() - Date.parse(renderedAt) > STALE_PAGE_MS ? renderedAt : null);
  }, [renderedAt]);

  useEffect(() => {
    let cancelled = false;
    void configureOfflineQueue({
      staffKey,
      onSynced: () => startRefresh(() => router.refresh()),
    }).then(() => {
      if (!cancelled) void flushQueue(true);
    });

    const wake = () => {
      setOnline(navigator.onLine !== false);
      void flushQueue(true);
    };
    const offline = () => setOnline(false);
    const visible = () => {
      if (document.visibilityState === "visible") wake();
    };
    window.addEventListener("online", wake);
    window.addEventListener("offline", offline);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", visible);
    const timer = window.setInterval(tick, RETRY_EVERY_MS);
    return () => {
      cancelled = true;
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", offline);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", visible);
      window.clearInterval(timer);
    };
  }, [staffKey, router]);

  // Once the refresh after a send lands, the server's data shows those steps.
  useEffect(() => {
    if (refreshing) {
      wasRefreshing.current = true;
    } else if (wasRefreshing.current) {
      wasRefreshing.current = false;
      clearSent();
    }
  }, [refreshing]);

  const mine = queue.items.filter((i) => i.staffKey === queue.staffKey);
  const others = queue.items.length - mine.length;
  const refused = mine.filter((i) => i.state === "refused").length;
  const waiting = mine.length - refused;

  const lines: { text: string; tone: "warn" | "info" }[] = [];
  if (staleCopy || !queue.online) {
    lines.push({
      text: staleCopy
        ? `Offline — showing the last loaded list from ${timeLabel(queue.savedCopyFrom ?? renderedAt)}. Taps are saved on this phone.`
        : "No signal. Taps are saved on this phone and send when signal comes back.",
      tone: "warn",
    });
  }
  if (waiting > 0) {
    lines.push({
      text: queue.syncing && queue.online
        ? `Sending ${waiting} update${waiting === 1 ? "" : "s"}…`
        : `${waiting} update${waiting === 1 ? "" : "s"} waiting — will send when you have signal.`,
      tone: "info",
    });
  }
  if (refused > 0) {
    lines.push({ text: `${refused} update${refused === 1 ? "" : "s"} couldn't be saved. See the job card.`, tone: "warn" });
  }
  if (queue.needsSignIn && mine.length > 0) {
    lines.push({ text: "You're signed out. Sign in again and the saved updates will send.", tone: "warn" });
  }
  if (!queue.storageOk && mine.length > 0) {
    lines.push({ text: "This phone isn't letting the app save. Keep this screen open until updates send.", tone: "warn" });
  }

  if (lines.length === 0 && others === 0) return null;

  return (
    <div className="sticky top-0 z-20 flex flex-col gap-2" role="status" aria-live="polite">
      {lines.map((line) => (
        <p
          key={line.text}
          className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
            line.tone === "warn" ? "border-accent/60 bg-navy-2 text-white" : "border-white/15 bg-navy-2 text-white"
          }`}
        >
          {line.text}
        </p>
      ))}
      {others > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/15 bg-navy-2 px-3 py-2 text-sm text-white">
          <span>
            {others} update{others === 1 ? "" : "s"} saved on this phone under another sign-in. They can&apos;t be sent as you.
          </span>
          <button
            type="button"
            className="rounded-lg border border-white/20 px-2 py-1 text-xs font-bold uppercase tracking-wide"
            onClick={() => {
              if (window.confirm("Remove the updates saved under the other sign-in? They will not be sent.")) {
                void discardOtherSignIns();
              }
            }}
          >
            Remove them
          </button>
        </div>
      )}
    </div>
  );
}
