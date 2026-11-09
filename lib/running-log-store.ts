import { after } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireOffice } from "@/lib/require-role";
import { getMyStaffId } from "@/lib/job-access";
import { one } from "@/lib/appointment-reminder";
import { postToTeams } from "@/lib/teams";
import { CRM_HUB_URL } from "@/lib/field-board-links";
import { addJobNote } from "@/app/(internal)/jobs/notebook-actions";
import {
  buildLogTeamsCard,
  foldPatch,
  isLogTableMissing,
  jobLabel,
  LOG_MIGRATION_MESSAGE,
  LOG_TEAMS_CHANNEL,
  logEntryLine,
  matchLogEntries,
  parseOptionalId,
  validateLogInput,
  type LogSection,
} from "@/lib/running-log";

// Running log writes, shared by the /log page and the assistant tools (CRM chat,
// Teams/Copilot agent, MCP). Owner and office only. Nothing here deletes.

const NOT_ALLOWED = "Not allowed";

async function officeOnly(): Promise<string | null> {
  try {
    await requireOffice();
    return null;
  } catch {
    return NOT_ALLOWED;
  }
}

function dbError(message: string | undefined): string {
  return isLogTableMissing(message) ? LOG_MIGRATION_MESSAGE : "Couldn't save. Try again.";
}

/** Posts the new entry to its Teams channel. Never throws; a channel with no webhook is skipped. */
async function postLogEntryToTeams(entry: {
  section: LogSection;
  body: string;
  createdAt: string;
  author: string | null;
  via: string | null;
  jobId: string | null;
  customerId: string | null;
}) {
  try {
    let label: string | null = null;
    let customerName: string | null = null;
    if (entry.jobId) {
      const { data } = await supabase
        .from("jobs")
        .select("scheduled_at, customers(name), properties(address)")
        .eq("id", entry.jobId)
        .maybeSingle();
      if (data) {
        label = jobLabel({
          customerName: one(data.customers as { name: string | null } | { name: string | null }[] | null)?.name,
          address: one(data.properties as { address: string | null } | { address: string | null }[] | null)?.address,
          scheduledAt: (data.scheduled_at as string | null) ?? null,
        });
      }
    } else if (entry.customerId) {
      const { data } = await supabase.from("customers").select("name").eq("id", entry.customerId).maybeSingle();
      customerName = (data?.name as string | null) ?? null;
    }
    await postToTeams(
      LOG_TEAMS_CHANNEL[entry.section],
      buildLogTeamsCard({ ...entry, jobLabel: label, customerName, baseUrl: CRM_HUB_URL })
    );
  } catch (err) {
    console.error("[log] Teams post failed:", err instanceof Error ? err.name : "error");
  }
}

export type CreateLogResult = { error: string } | { ok: true; id: string; warning?: string };

/**
 * Saves one entry. A Jobs entry with a job also goes in that job's Notebook (and from
 * there to OneNote) through addJobNote; if that fails the entry stays saved and the
 * result carries a warning. Every new entry is posted once to its Teams channel after
 * the response (addJobNote itself posts nothing to Teams, so there is no double post).
 * `via` marks entries written through an agent ("Teams agent", "assistant").
 */
export async function createLogEntry(
  raw: { section: unknown; body: unknown; jobId?: unknown; customerId?: unknown },
  opts: { via?: string | null } = {}
): Promise<CreateLogResult> {
  const denied = await officeOnly();
  if (denied) return { error: denied };

  const checked = validateLogInput(raw);
  if ("error" in checked) return { error: checked.error };
  const { section, body, jobId, customerId } = checked.value;

  const createdBy = await getMyStaffId();
  let author: string | null = null;
  if (createdBy) {
    const { data: staff } = await supabase.from("staff").select("name").eq("id", createdBy).maybeSingle();
    author = (staff?.name as string | null) ?? null;
  }

  const { data, error } = await supabase
    .from("log_entries")
    .insert({ section, body, job_id: jobId, customer_id: customerId, created_by: createdBy })
    .select("id, created_at")
    .single();
  if (error || !data) {
    if (/foreign key/i.test(error?.message ?? "")) return { error: "That job or customer is gone. Pick again." };
    return { error: dbError(error?.message) };
  }

  const via = opts.via ?? null;
  after(() =>
    postLogEntryToTeams({ section, body, createdAt: data.created_at as string, author, via, jobId, customerId })
  );

  if (jobId) {
    let copyError: string | undefined;
    try {
      copyError = (await addJobNote(jobId, via && !author ? `${body}\n\n(via ${via})` : body)).error;
    } catch {
      copyError = "unknown error";
    }
    if (copyError) {
      return {
        ok: true,
        id: data.id as string,
        warning: `Saved to the log, but the copy to the job's Notebook didn't go through (${copyError}).`,
      };
    }
  }
  return { ok: true, id: data.id as string };
}

/** Folds or unfolds one entry by id. */
export async function setLogFolded(id: string, folded: boolean): Promise<{ error?: string; ok?: boolean }> {
  const denied = await officeOnly();
  if (denied) return { error: denied };
  const entryId = parseOptionalId(id);
  if (!entryId || entryId === "bad") return { error: "That entry couldn't be found." };

  const { data, error } = await supabase
    .from("log_entries")
    .update(foldPatch(folded === true))
    .eq("id", entryId)
    .select("id");
  if (error) return { error: dbError(error.message) };
  if (!data || data.length === 0) return { error: "That entry couldn't be found." };
  return { ok: true };
}

type ToolRow = {
  id: string;
  section: LogSection;
  body: string;
  created_at: string;
  folded: boolean;
  author: { name: string | null } | { name: string | null }[] | null;
};

const TOOL_SELECT = "id, section, body, created_at, folded, author:staff!log_entries_created_by_fkey(name)";

function toLine(row: ToolRow): string {
  return logEntryLine({ ...row, author: one(row.author)?.name ?? null });
}

/** Text listing for the assistant, newest first. */
export async function listLogForAssistant(opts: {
  section?: LogSection | null;
  includeFolded?: boolean;
  limit?: number;
}): Promise<string> {
  const denied = await officeOnly();
  if (denied) return denied;
  let query = supabase.from("log_entries").select(TOOL_SELECT).order("created_at", { ascending: false });
  if (opts.section) query = query.eq("section", opts.section);
  if (!opts.includeFolded) query = query.eq("folded", false);
  const { data, error } = await query.limit(Math.min(Math.max(opts.limit ?? 40, 1), 200));
  if (error) return isLogTableMissing(error.message) ? LOG_MIGRATION_MESSAGE : "Couldn't read the log.";
  const rows = (data ?? []) as unknown as ToolRow[];
  if (rows.length === 0) return opts.includeFolded ? "The log is empty here." : "No open entries here.";
  return rows.map(toLine).join("\n");
}

/**
 * Folds (or unfolds) the entry the assistant named: by id, or by a piece of its text
 * that must match exactly one entry. More than one match returns the candidates.
 */
export async function foldLogForAssistant(
  target: { id: string } | { match: string },
  folded: boolean,
  section?: LogSection | null
): Promise<string> {
  const denied = await officeOnly();
  if (denied) return denied;
  const verb = folded ? "Folded" : "Unfolded";

  if ("id" in target) {
    const result = await setLogFolded(target.id, folded);
    return result.error ?? `${verb} entry ${target.id}.`;
  }

  // Only entries that can change: open ones to fold, folded ones to unfold.
  let query = supabase
    .from("log_entries")
    .select(TOOL_SELECT)
    .eq("folded", !folded)
    .order("created_at", { ascending: false });
  if (section) query = query.eq("section", section);
  const { data, error } = await query.limit(1000);
  if (error) return isLogTableMissing(error.message) ? LOG_MIGRATION_MESSAGE : "Couldn't read the log.";
  const matches = matchLogEntries((data ?? []) as unknown as ToolRow[], target.match);

  if (matches.length === 0) {
    return `No ${folded ? "open" : "folded"} entry has "${target.match}" in it. Use list_log to see them.`;
  }
  if (matches.length > 1) {
    return [
      `${matches.length} entries match "${target.match}". Ask which one, then call again with its id:`,
      ...matches.slice(0, 10).map(toLine),
    ].join("\n");
  }
  const result = await setLogFolded(matches[0].id, folded);
  return result.error ?? `${verb}: ${toLine({ ...matches[0], folded })}`;
}
