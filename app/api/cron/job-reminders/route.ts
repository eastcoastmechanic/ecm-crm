import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resend, RESEND_FROM_EMAIL } from "@/lib/resend";
import { etDateKey, etDayRange, etHour, formatEtDateTime } from "@/lib/tz";
import { buildJobDigests, type DigestJob } from "@/lib/job-digest";

const OWNER_EMAIL = process.env.OWNER_EMAIL ?? null;
const DIGEST_HOUR_ET = 7;

type CustomerRel = { name: string | null; phone: string | null };
type PropertyRel = { address: string | null; access_notes: string | null };

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

// Morning digest: each tech gets today's jobs assigned to them, the owner gets
// all of today's jobs. vercel.json runs this at 11:00 and 12:00 UTC so one of
// them lands on 7:00 New York time in both EDT and EST; the other run exits.
// ?force=1 skips the hour check for a manual test run.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force && etHour() !== DIGEST_HOUR_ET) {
    return NextResponse.json({ sent: 0, skipped: "not 7am in New York" });
  }

  const todayKey = etDateKey();
  const today = etDayRange(todayKey);

  const [{ data: jobRows, error: jobsError }, { data: staffRows, error: staffError }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, scheduled_at, job_type, status, assigned_staff_id, customers(name, phone), properties(address, access_notes)")
      .not("status", "in", "(complete,completed,cancelled)")
      .gte("scheduled_at", today.start.toISOString())
      .lt("scheduled_at", today.end.toISOString())
      .order("scheduled_at", { ascending: true }),
    supabase.from("staff").select("id, name, email"),
  ]);

  if (jobsError) return NextResponse.json({ sent: 0, errors: [jobsError.message] });
  if (staffError) return NextResponse.json({ sent: 0, errors: [staffError.message] });

  const jobs: DigestJob[] = (jobRows ?? []).map((row) => {
    const customer = one(row.customers as CustomerRel | CustomerRel[] | null);
    const property = one(row.properties as PropertyRel | PropertyRel[] | null);
    return {
      id: row.id as string,
      scheduledAt: row.scheduled_at as string,
      jobType: (row.job_type as string | null) ?? null,
      status: row.status as string,
      assignedStaffId: (row.assigned_staff_id as string | null) ?? null,
      customer: customer?.name ?? null,
      phone: customer?.phone ?? null,
      address: property?.address ?? null,
      accessNotes: property?.access_notes ?? null,
    };
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const emails = buildJobDigests({
    jobs,
    staff: (staffRows ?? []).map((s) => ({
      id: s.id as string,
      name: (s.name as string | null) ?? null,
      email: (s.email as string | null) ?? null,
    })),
    ownerEmail: OWNER_EMAIL,
    dayLabel: formatEtDateTime(today.start, { weekday: "long", month: "short", day: "numeric" }),
    boardUrl: appUrl ? `${appUrl}/field-board` : null,
  });

  const errors: string[] = [];
  if (!OWNER_EMAIL) errors.push("OWNER_EMAIL not configured; owner digest skipped");

  let sent = 0;
  for (const email of emails) {
    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      to: email.to,
      subject: email.subject,
      text: email.text,
    });
    if (sendError) {
      errors.push(`${email.to}: ${sendError.message}`);
      continue;
    }
    sent++;
  }

  return NextResponse.json({ date: todayKey, jobs: jobs.length, sent, errors });
}
