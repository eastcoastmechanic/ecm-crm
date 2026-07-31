import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resend, RESEND_FROM_EMAIL } from "@/lib/resend";

const OWNER_EMAIL = process.env.OWNER_EMAIL;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!OWNER_EMAIL) {
    return NextResponse.json({ sent: 0, errors: ["OWNER_EMAIL not configured"] });
  }

  const windowStart = new Date(Date.now() + 45 * 60 * 1000);
  const windowEnd = new Date(Date.now() + 75 * 60 * 1000);

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, scheduled_at, customers(name), properties(address)")
    .in("status", ["scheduled", "in_progress"])
    .gte("scheduled_at", windowStart.toISOString())
    .lte("scheduled_at", windowEnd.toISOString())
    .is("reminder_sent_at", null);

  if (error) return NextResponse.json({ sent: 0, errors: [error.message] });

  const errors: string[] = [];
  let sent = 0;

  for (const job of jobs ?? []) {
    const customer = job.customers as unknown as { name: string | null } | null;
    const property = job.properties as unknown as { address: string | null } | null;
    const when = new Date(job.scheduled_at).toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });

    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      to: OWNER_EMAIL,
      subject: `Reminder: job in about 1 hour (${when})`,
      text: `You have a job coming up at ${when} with ${customer?.name ?? "Unknown customer"}${
        property?.address ? ` at ${property.address}` : ""
      }.`,
    });

    if (sendError) {
      errors.push(`job ${job.id}: ${sendError.message}`);
      continue;
    }

    await supabase.from("jobs").update({ reminder_sent_at: new Date().toISOString() }).eq("id", job.id);
    sent++;
  }

  return NextResponse.json({ sent, errors });
}
