import { supabase } from "@/lib/supabase";
import { documentMoneyTotals } from "@/lib/document-totals";
import { etDateKey, etDayRange, addDaysToDateKey, formatEtTime } from "@/lib/tz";
import { visitOverdue } from "@/lib/maintenance-visits";
import { followUpState } from "@/lib/lead-follow-up";
import { FIRST_FOLLOW_UP_DAY } from "@/lib/estimate-follow-up";
import { one } from "@/lib/appointment-reminder";

/**
 * The morning brief. One loader reads the numbers, two formatters turn them into
 * a Teams card: the owner card has money, the tech card (for the dispatch channel,
 * which techs can read) never does.
 *
 * A piece that could not be read comes back as null and the card says so. It is
 * never shown as zero: "0 unpaid" and "could not check" are different news.
 */

export type BriefJob = {
  time: string;
  customer: string | null;
  address: string | null;
  jobType: string | null;
  tech: string | null;
};

export type DailyBrief = {
  dateKey: string;
  jobs: BriefJob[] | null;
  /** Requested jobs that have no time yet. */
  unscheduledRequested: number | null;
  overduePlanVisits: number | null;
  outstanding: { total: number; count: number } | null;
  leadsDueToday: number | null;
  leadsOverdue: number | null;
  /** Estimates sent (sent_at, not drafted) FIRST_FOLLOW_UP_DAY or more New York days ago and not approved. */
  staleEstimates: number | null;
};

type Rel = { name?: string | null; address?: string | null };

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export async function loadDailyBrief(now: Date = new Date()): Promise<DailyBrief> {
  const dateKey = etDateKey(now);
  const day = etDayRange(dateKey);
  const staleCutoff = etDayRange(addDaysToDateKey(dateKey, -FIRST_FOLLOW_UP_DAY)).end.toISOString();

  const [jobsRes, staffRes, requestedRes, visitsRes, money_, leadsRes, estimatesRes] = await Promise.all([
    supabase
      .from("jobs")
      .select("scheduled_at, job_type, assigned_staff_id, customers(name), properties(address)")
      .not("status", "in", "(complete,completed,cancelled)")
      .gte("scheduled_at", day.start.toISOString())
      .lt("scheduled_at", day.end.toISOString())
      .order("scheduled_at", { ascending: true }),
    supabase.from("staff").select("id, name"),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "requested").is("scheduled_at", null),
    supabase.from("maintenance_visits").select("due_year, due_month").eq("status", "due"),
    documentMoneyTotals(),
    supabase.from("leads").select("status, follow_up_on").not("follow_up_on", "is", null).lte("follow_up_on", dateKey),
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("type", "estimate")
      .eq("status", "sent")
      .lte("sent_at", staleCutoff),
  ]);

  const staffNames = new Map<string, string>();
  for (const s of staffRes.data ?? []) staffNames.set(s.id as string, (s.name as string | null) ?? "");

  const jobs: BriefJob[] | null = jobsRes.error
    ? null
    : (jobsRes.data ?? []).map((row) => {
        const customer = one(row.customers as Rel | Rel[] | null);
        const property = one(row.properties as Rel | Rel[] | null);
        const staffId = row.assigned_staff_id as string | null;
        return {
          time: formatEtTime(row.scheduled_at as string),
          customer: customer?.name ?? null,
          address: property?.address ?? null,
          jobType: (row.job_type as string | null) ?? null,
          // A tech we cannot name (staff read failed) shows as unassigned only when there is no id.
          tech: staffId ? staffNames.get(staffId) || "Assigned" : null,
        };
      });

  let leadsDueToday: number | null = null;
  let leadsOverdue: number | null = null;
  if (!leadsRes.error) {
    leadsDueToday = 0;
    leadsOverdue = 0;
    for (const lead of leadsRes.data ?? []) {
      const state = followUpState(lead.follow_up_on as string, String(lead.status ?? ""), dateKey);
      if (state === "today") leadsDueToday += 1;
      if (state === "overdue") leadsOverdue += 1;
    }
  }

  return {
    dateKey,
    jobs,
    unscheduledRequested: requestedRes.error ? null : (requestedRes.count ?? 0),
    overduePlanVisits: visitsRes.error
      ? null
      : (visitsRes.data ?? []).filter((v) => visitOverdue(v.due_year as number, v.due_month as number, dateKey)).length,
    outstanding: money_.error ? null : { total: money_.totals.outstandingTotal, count: money_.totals.outstandingCount },
    leadsDueToday,
    leadsOverdue,
    staleEstimates: estimatesRes.error ? null : (estimatesRes.count ?? 0),
  };
}

function jobLines(jobs: BriefJob[], withTech: boolean): string[] {
  return jobs.map((j) => {
    const parts = [`${j.time}`, j.customer ?? "No customer", j.address, j.jobType].filter(Boolean);
    const who = withTech ? ` (${j.tech ?? "unassigned"})` : "";
    return `- ${parts.join(" · ")}${who}`;
  });
}

function dayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Owner card: jobs, then what needs a decision or money. */
export function formatOwnerBrief(brief: DailyBrief): { title: string; text: string } {
  const lines: string[] = [];

  lines.push("**Today's jobs**");
  if (brief.jobs === null) lines.push("- Couldn't read today's jobs. Check the Jobs page.");
  else if (brief.jobs.length === 0) lines.push("- Nothing scheduled.");
  else lines.push(...jobLines(brief.jobs, true));

  const unassigned = brief.jobs?.filter((j) => !j.tech).length ?? 0;
  const attention: string[] = [];
  if (unassigned > 0) attention.push(`${plural(unassigned, "job today has", "jobs today have")} no tech assigned`);
  if (brief.unscheduledRequested === null) attention.push("Couldn't check requested jobs");
  else if (brief.unscheduledRequested > 0)
    attention.push(`${plural(brief.unscheduledRequested, "requested job needs", "requested jobs need")} a time`);
  if (brief.overduePlanVisits === null) attention.push("Couldn't check plan visits");
  else if (brief.overduePlanVisits > 0)
    attention.push(`${plural(brief.overduePlanVisits, "plan visit is", "plan visits are")} overdue`);
  if (brief.leadsOverdue === null) attention.push("Couldn't check lead follow-ups");
  else {
    if (brief.leadsOverdue > 0) attention.push(`${plural(brief.leadsOverdue, "lead follow-up is", "lead follow-ups are")} overdue`);
    if ((brief.leadsDueToday ?? 0) > 0)
      attention.push(`${plural(brief.leadsDueToday ?? 0, "lead follow-up is", "lead follow-ups are")} due today`);
  }
  if (brief.staleEstimates === null) attention.push("Couldn't check estimates");
  else if (brief.staleEstimates > 0)
    attention.push(`${plural(brief.staleEstimates, "estimate has", "estimates have")} gone ${FIRST_FOLLOW_UP_DAY}+ days with no approval`);

  lines.push("", "**Needs you**");
  lines.push(...(attention.length ? attention.map((a) => `- ${a}`) : ["- Nothing waiting."]));

  lines.push("", "**Money**");
  if (brief.outstanding === null) lines.push("- Couldn't read unpaid invoices.");
  else if (brief.outstanding.count === 0) lines.push("- No unpaid invoices.");
  else lines.push(`- ${plural(brief.outstanding.count, "invoice", "invoices")} unpaid, ${money(brief.outstanding.total)}`);

  return { title: `ECM morning brief, ${dayLabel(brief.dateKey)}`, text: lines.join("\n\n").replace(/\n\n- /g, "\n- ") };
}

/** Dispatch card: jobs and who has them. No money, no customer phone numbers. */
export function formatTechBrief(brief: DailyBrief): { title: string; text: string } {
  const lines: string[] = [];
  if (brief.jobs === null) lines.push("Couldn't read today's jobs. Check the Jobs page.");
  else if (brief.jobs.length === 0) lines.push("Nothing scheduled today.");
  else lines.push(...jobLines(brief.jobs, true));
  return { title: `Today's jobs, ${dayLabel(brief.dateKey)}`, text: lines.join("\n") };
}
