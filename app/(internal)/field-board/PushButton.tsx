"use client";

import { useEffect, useState } from "react";
import { savePushSubscription, removePushSubscription } from "./push-actions";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function keyToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type Status = "loading" | "unsupported" | "off" | "on" | "blocked";

/** Turn job alerts on or off for this phone. Hidden when the app has no push key yet. */
export default function PushButton() {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    async function check(): Promise<Status> {
      if (!VAPID_PUBLIC || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
      if (Notification.permission === "denied") return "blocked";
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        return sub ? "on" : "off";
      } catch {
        return "unsupported";
      }
    }
    check().then((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (status === "loading" || status === "unsupported") return null;

  async function turnOn() {
    setBusy(true);
    setError(null);
    let created: PushSubscription | null = null;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC) });
      created = sub;
      const res = await savePushSubscription(sub.toJSON(), navigator.userAgent);
      if (!res.ok) {
        await sub.unsubscribe();
        setError(res.error);
        return;
      }
      setStatus("on");
    } catch {
      // The phone may hold a subscription the server never saved. Drop it so the button
      // does not claim alerts are on when the server has nothing to send to.
      try {
        await created?.unsubscribe();
      } catch {
        // nothing more to do
      }
      setError("Could not turn alerts on. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch {
      setError("Could not turn alerts off. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-white/8 bg-white/3 p-3 text-sm">
      {status === "blocked" ? (
        <p className="text-g300">Alerts are blocked for this app. Turn them on in your phone settings for ECM.</p>
      ) : status === "on" ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-g300">Job alerts are on for this phone.</p>
          <button type="button" onClick={turnOff} disabled={busy} className="text-xs font-bold uppercase tracking-wide text-g300 underline disabled:opacity-50">
            Turn off
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-g300">Get a buzz when a job is assigned or moved.</p>
          <button
            type="button"
            onClick={turnOn}
            disabled={busy}
            className="rounded-lg bg-accent px-3 py-2 text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
          >
            {busy ? "Turning on…" : "Turn on alerts"}
          </button>
        </div>
      )}
      {error && <p className="text-accent">{error}</p>}
    </div>
  );
}
