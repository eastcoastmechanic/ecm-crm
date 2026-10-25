import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/sms";
import { addDaysToDateKey, etDateKey, etDayRange } from "@/lib/tz";
import { appointmentReminder, type ReminderJobRow } from "@/lib/appointment-reminder";

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // "Tomorrow" is the New York calendar day, not the server's (UTC) day.
  const tomorrow = etDayRange(addDaysToDateKey(etDateKey(), 1));

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, scheduled_at, customers(name, phone, sms_consent), properties(address)")
    .in("status", ["scheduled", "in_progress"])
    .gte("scheduled_at", tomorrow.start.toISOString())
    .lt("scheduled_at", tomorrow.end.toISOString())
    .is("appointment_reminder_sent_at", null);

  if (error) return NextResponse.json({ sent: 0, errors: [error.message] });

  const errors: string[] = [];
  const skipped: Record<string, number> = {};
  let sent = 0;

  for (const job of jobs ?? []) {
    const decision = appointmentReminder(job as unknown as ReminderJobRow);

    if (!decision.send) {
      skipped[decision.reason] = (skipped[decision.reason] ?? 0) + 1;
      continue;
    }

    try {
      const result = await sendSMS(decision.phone, decision.body);
      if (!result.ok) {
        errors.push(`job ${job.id}: ${result.error ?? "send failed"}`);
        continue;
      }
      await supabase
        .from("jobs")
        .update({ appointment_reminder_sent_at: new Date().toISOString() })
        .eq("id", job.id);
      sent++;
    } catch (err) {
      errors.push(`job ${job.id}: ${err instanceof Error ? err.message : "send failed"}`);
    }
  }

  return NextResponse.json({ jobs: jobs?.length ?? 0, sent, skipped, errors });
}
