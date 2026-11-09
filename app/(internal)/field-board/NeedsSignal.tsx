"use client";

import { useOfflineQueue } from "./offline-store";

/**
 * Wraps buttons that only work live (checklist ticks). With no signal they are greyed out with
 * a plain line, instead of the tap failing and the screen showing an error page.
 */
export default function NeedsSignal({
  what,
  className = "",
  children,
}: {
  what: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { online } = useOfflineQueue();
  return (
    <fieldset disabled={!online} className={`m-0 min-w-0 border-0 p-0 disabled:opacity-60 ${className}`}>
      {!online && <p className="mb-2 text-xs text-g300">{what} needs signal.</p>}
      {children}
    </fieldset>
  );
}
