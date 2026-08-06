"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-runs the server fetch on an interval so new leads (from the daily
// sweep cron, or another tab adding one) show up without a manual reload.
// Pauses while the tab is hidden so it doesn't burn requests in the
// background all day.
export default function AutoRefresh({ intervalMs = 30000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
