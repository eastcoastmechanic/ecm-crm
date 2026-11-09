import { supabase } from "@/lib/supabase";
import { getStaffRole } from "@/lib/require-role";
import { one } from "@/lib/appointment-reminder";
import { fetchAllRows, pageLimit } from "@/lib/fetch-all";
import {
  isLogTableMissing,
  jobLabel,
  limitParam,
  LOG_MIGRATION_MESSAGE,
  LOG_PAGE_MAX,
  LOG_PAGE_STEP,
  LOG_SECTION_LABEL,
  LOG_SECTIONS,
  type LogSection,
} from "@/lib/running-log";
import LogSectionPanel, { type LogEntryView, type PickerOption } from "./LogSectionPanel";
import { errorClass, headingClass, subTextClass } from "../ui";

export const dynamic = "force-dynamic";

const ENTRY_SELECT =
  "id, body, job_id, customer_id, created_at, folded, folded_at, " +
  "author:staff!log_entries_created_by_fkey(name), " +
  "job:jobs!log_entries_job_id_fkey(id, scheduled_at, customers(name), properties(address)), " +
  "customer:customers!log_entries_customer_id_fkey(id, name)";

type Rel<T> = T | T[] | null;
type EntryRow = {
  id: string;
  body: string;
  job_id: string | null;
  customer_id: string | null;
  created_at: string;
  folded: boolean;
  folded_at: string | null;
  author: Rel<{ name: string | null }>;
  job: Rel<{
    id: string;
    scheduled_at: string | null;
    customers: Rel<{ name: string | null }>;
    properties: Rel<{ address: string | null }>;
  }>;
  customer: Rel<{ id: string; name: string | null }>;
};

function toView(row: EntryRow): LogEntryView {
  const job = one(row.job);
  const customer = one(row.customer);
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    folded: row.folded,
    author: one(row.author)?.name ?? null,
    job: job
      ? {
          id: job.id,
          label: jobLabel({
            customerName: one(job.customers)?.name,
            address: one(job.properties)?.address,
            scheduledAt: job.scheduled_at,
          }),
        }
      : null,
    customer: customer ? { id: customer.id, name: customer.name ?? "Customer" } : null,
  };
}

async function loadEntries(section: LogSection, folded: boolean, limit: number) {
  const { data, error } = await supabase
    .from("log_entries")
    .select(ENTRY_SELECT)
    .eq("section", section)
    .eq("folded", folded)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (error) return { error: error.message, entries: [] as LogEntryView[], more: false };
  const rows = (data ?? []) as unknown as EntryRow[];
  return { error: null, entries: rows.slice(0, limit).map(toView), more: rows.length > limit };
}

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getStaffRole();
  if (role !== "owner" && role !== "office") {
    return (
      <div className="flex flex-col gap-2">
        <h1 className={headingClass}>Log</h1>
        <p className={subTextClass}>The log is for the office and the owner.</p>
      </div>
    );
  }

  const params = await searchParams;
  const limits = Object.fromEntries(
    LOG_SECTIONS.flatMap((s) => [
      [limitParam(s, "open"), pageLimit(params[limitParam(s, "open")], LOG_PAGE_STEP, LOG_PAGE_MAX)],
      [limitParam(s, "folded"), pageLimit(params[limitParam(s, "folded")], LOG_PAGE_STEP, LOG_PAGE_MAX)],
    ])
  ) as Record<string, number>;

  const [sections, jobsRes, customersRes] = await Promise.all([
    Promise.all(
      LOG_SECTIONS.map(async (section) => {
        const [open, folded] = await Promise.all([
          loadEntries(section, false, limits[limitParam(section, "open")]),
          loadEntries(section, true, limits[limitParam(section, "folded")]),
        ]);
        return { section, open, folded };
      })
    ),
    supabase
      .from("jobs")
      .select("id, scheduled_at, customers(name), properties(address)")
      .or("status.is.null,status.not.in.(cancelled,canceled)")
      .order("scheduled_at", { ascending: false, nullsFirst: true })
      .limit(150),
    fetchAllRows<{ id: string; name: string | null }>((from, to) =>
      supabase.from("customers").select("id, name").order("name").order("id").range(from, to)
    ),
  ]);

  const firstError = sections.flatMap((s) => [s.open.error, s.folded.error]).find(Boolean) ?? null;
  if (firstError) {
    const missing = isLogTableMissing(firstError);
    return (
      <div className="flex flex-col gap-2">
        <h1 className={headingClass}>Log</h1>
        <p className={errorClass}>
          {missing
            ? role === "owner"
              ? LOG_MIGRATION_MESSAGE
              : "The log isn't turned on yet. Ask Josh."
            : "Couldn't load the log. Refresh to try again."}
        </p>
      </div>
    );
  }

  type JobPickRow = {
    id: string;
    scheduled_at: string | null;
    customers: Rel<{ name: string | null }>;
    properties: Rel<{ address: string | null }>;
  };
  const jobOptions: PickerOption[] = ((jobsRes.data ?? []) as unknown as JobPickRow[]).map((j) => ({
    id: j.id,
    label: jobLabel({
      customerName: one(j.customers)?.name,
      address: one(j.properties)?.address,
      scheduledAt: j.scheduled_at,
    }),
  }));
  const customerOptions: PickerOption[] = customersRes.data.map(
    (c) => ({ id: c.id, label: c.name ?? "No name" })
  );

  function olderHref(section: LogSection, state: "open" | "folded") {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(limits)) if (value > LOG_PAGE_STEP) next.set(key, String(value));
    const key = limitParam(section, state);
    next.set(key, String(limits[key] + LOG_PAGE_STEP));
    return `/log?${next.toString()}#log-${section}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className={headingClass}>Log</h1>
        <p className={subTextClass}>
          Running notes. Fold an entry to tuck it away; it stays in the log under Folded. Nothing here is deleted.
        </p>
      </div>

      {sections.map(({ section, open, folded }) => (
        <LogSectionPanel
          key={section}
          section={section}
          label={LOG_SECTION_LABEL[section]}
          open={open.entries}
          folded={folded.entries}
          olderOpenHref={open.more ? olderHref(section, "open") : null}
          olderFoldedHref={folded.more ? olderHref(section, "folded") : null}
          jobOptions={section === "jobs" ? jobOptions : undefined}
          customerOptions={section === "texts" ? customerOptions : undefined}
        />
      ))}
    </div>
  );
}
