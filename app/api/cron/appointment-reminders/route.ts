import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/sms";
import { addDaysToDateKey, etDateKey, etDayRange, formatEtDateTime } from "@/lib/tz";

type CustomerContact = { name: string | null; phone: string | null; sms_consent: boolean } | null;

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
  let sent = 0;
  let skipped = 0;

  for (const job of jobs ?? []) {
    const customer = (job.customers as unknown as CustomerContact[] | null)?.[0];
    const property = (job.properties as unknown as { address: string | null }[] | null)?.[0];

    if (!customer?.phone || !customer.sms_consent) {
      skipped++;
      continue;
    }

    const when = formatEtDateTime(job.scheduled_at, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });

    try {
      const result = await sendSMS(
        customer.phone,
        `East Coast Mechanical: reminder — you're scheduled for ${when}${
          property?.address ? ` at ${property.address}` : ""
        }. Reply STOP to opt out.`
      );
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

  return NextResponse.json({ sent, skipped, errors });
}
