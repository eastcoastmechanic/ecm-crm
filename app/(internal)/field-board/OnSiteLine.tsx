"use client";

import { useEffect, useState } from "react";

function spentLabel(startMs: number, endMs: number) {
  const minutes = Math.max(0, Math.round((endMs - startMs) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Time on site. Ticks every 30s while the job is open so a board left on screen stays current. */
export default function OnSiteLine({
  arrivedAt,
  completedAt,
  status,
  sinceLabel,
}: {
  arrivedAt: string;
  completedAt: string | null;
  status: string;
  sinceLabel: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const open = status === "in_progress";
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [open]);

  const start = new Date(arrivedAt).getTime();
  if (status === "complete") {
    if (!completedAt) return null;
    return <>On site {spentLabel(start, new Date(completedAt).getTime())}</>;
  }
  if (open) return <>On site since {sinceLabel} ({spentLabel(start, now)})</>;
  return null;
}
