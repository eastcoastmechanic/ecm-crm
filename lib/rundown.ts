import { supabase } from "@/lib/supabase";
import { mergeRun, type RundownBody, type RundownItemRow } from "@/lib/rundown-rules";

/**
 * Daily rundown storage: one run per POST, one row per item key (SQL 0087).
 * The Planner push lives in lib/rundown-planner.ts and runs after the response.
 */

export const ITEM_COLUMNS =
  "bot, key, section, title, detail, due, priority, source, job_id, lead_id, customer_id, text_draft, status, first_run_date, last_run_date, last_seen_at, last_run_id, needs_push, done_at, done_by, done_source";

export type IngestResult =
  | {
      ok: true;
      run_id: string;
      created: number;
      updated: number;
      unchanged: number;
      already_done: string[];
      closed: string[];
      auto_closed: string[];
      warnings: string[];
    }
  | { ok: false; status: number; error: string };

function missingTable(message: string | undefined): boolean {
  return /rundown_(runs|items)/.test(message ?? "") && /does not exist|schema cache/.test(message ?? "");
}

/** Ids from `ids` that exist in `table`. A failed lookup keeps them all (the foreign key still guards). */
async function existingIds(table: "jobs" | "leads" | "customers", ids: string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  const { data, error } = await supabase.from(table).select("id").in("id", unique);
  if (error) return new Set(unique);
  return new Set((data ?? []).map((r) => String(r.id).toLowerCase()));
}

/** Links to records that don't exist are dropped (with a warning) so one bad id can't fail the run. */
async function dropUnknownLinks(body: RundownBody, warnings: string[]): Promise<RundownBody> {
  const jobIds = body.items.map((i) => i.job_id?.toLowerCase()).filter((v): v is string => Boolean(v));
  const leadIds = body.items.map((i) => i.lead_id?.toLowerCase()).filter((v): v is string => Boolean(v));
  const customerIds = body.items
    .flatMap((i) => [i.customer_id, i.text_draft?.customer_id])
    .map((v) => v?.toLowerCase())
    .filter((v): v is string => Boolean(v));
  const [jobs, leads, customers] = await Promise.all([
    existingIds("jobs", jobIds),
    existingIds("leads", leadIds),
    existingIds("customers", customerIds),
  ]);
  return {
    ...body,
    items: body.items.map((item) => {
      const next = { ...item };
      if (next.job_id && !jobs.has(next.job_id.toLowerCase())) {
        warnings.push(`${item.key}: job_id not found, link dropped`);
        next.job_id = null;
      }
      if (next.lead_id && !leads.has(next.lead_id.toLowerCase())) {
        warnings.push(`${item.key}: lead_id not found, link dropped`);
        next.lead_id = null;
      }
      if (next.customer_id && !customers.has(next.customer_id.toLowerCase())) {
        warnings.push(`${item.key}: customer_id not found, link dropped`);
        next.customer_id = null;
      }
      if (next.text_draft && !customers.has(next.text_draft.customer_id.toLowerCase())) {
        warnings.push(`${item.key}: text_draft customer not found, draft kept as plain detail`);
        next.detail = [next.detail, `Text draft (customer not found): ${next.text_draft.body}`].filter(Boolean).join("\n\n");
        next.text_draft = null;
      }
      return next;
    }),
  };
}

/** Stores one run from a bot. Never touches Planner (the caller schedules the push). */
export async function ingestRundown(bot: string, body: RundownBody, raw: unknown): Promise<IngestResult> {
  const warnings: string[] = [];
  const checked = await dropUnknownLinks(body, warnings);

  const { data: run, error: runError } = await supabase
    .from("rundown_runs")
    .insert({
      bot,
      run_date: body.date,
      period_from: body.period?.from ?? null,
      period_to: body.period?.to ?? null,
      summary: body.summary ?? null,
      item_count: body.items.length,
      raw,
    })
    .select("id")
    .single();
  if (runError || !run) {
    if (missingTable(runError?.message)) return { ok: false, status: 503, error: "Rundown tables not set up yet (SQL 0087)." };
    console.error("[rundown] couldn't save run:", runError?.message);
    return { ok: false, status: 500, error: "Couldn't save the run. Try again." };
  }

  const keys = [...new Set([...checked.items.map((i) => i.key), ...(checked.closed_keys ?? [])])];
  const existing: RundownItemRow[] = [];
  // In slices so a long key list stays well under URL limits.
  for (let i = 0; i < keys.length; i += 100) {
    const { data, error } = await supabase
      .from("rundown_items")
      .select(ITEM_COLUMNS)
      .eq("bot", bot)
      .in("key", keys.slice(i, i + 100));
    if (error) {
      console.error("[rundown] couldn't read items:", error.message);
      return { ok: false, status: 500, error: "Couldn't read stored items. Try again." };
    }
    existing.push(...((data ?? []) as unknown as RundownItemRow[]));
  }
  const { data: openHappened } = await supabase
    .from("rundown_items")
    .select(ITEM_COLUMNS)
    .eq("bot", bot)
    .eq("status", "open")
    .eq("section", "happened")
    .limit(500);

  const now = new Date().toISOString();
  const merged = mergeRun({
    bot,
    body: checked,
    runId: run.id as string,
    now,
    existing,
    openHappened: (openHappened ?? []) as unknown as RundownItemRow[],
  });

  if (merged.rows.length > 0) {
    const rows = merged.rows.map((r) => ({ ...r, updated_at: now }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from("rundown_items").upsert(rows.slice(i, i + 200), { onConflict: "bot,key" });
      if (error) {
        console.error("[rundown] couldn't save items:", error.message);
        return { ok: false, status: 500, error: "Couldn't save the items. Try again; repeating a run is safe." };
      }
    }
  }

  return {
    ok: true,
    run_id: run.id as string,
    created: merged.created.length,
    updated: merged.updated.length,
    unchanged: merged.unchanged.length,
    already_done: merged.alreadyDone,
    closed: merged.closed,
    auto_closed: merged.autoClosed,
    warnings: [...warnings, ...merged.warnings],
  };
}

export type RundownStateItem = {
  key: string;
  section: string;
  title: string;
  status: string;
  done_at: string | null;
  done_by: string | null;
  done_source: string | null;
  last_run_date: string;
  on_planner: boolean;
  sent_at: string | null;
};

/**
 * Items for one bot so Grok can stop repeating finished ones: every open item, plus
 * items finished since `since` (default: the last 14 days).
 */
export async function rundownState(bot: string, since: string | null) {
  const sinceIso = since ?? new Date(Date.now() - 14 * 86_400_000).toISOString();
  const columns = "key, section, title, status, done_at, done_by, done_source, last_run_date, planner_task_id, sent_at";
  const [open, finished] = await Promise.all([
    supabase.from("rundown_items").select(columns).eq("bot", bot).eq("status", "open").order("first_seen_at").limit(1000),
    supabase
      .from("rundown_items")
      .select(columns)
      .eq("bot", bot)
      .neq("status", "open")
      .gte("done_at", sinceIso)
      .order("done_at", { ascending: false })
      .limit(1000),
  ]);
  if (open.error || finished.error) {
    const message = open.error?.message ?? finished.error?.message;
    if (missingTable(message)) return { ok: false as const, status: 503, error: "Rundown tables not set up yet (SQL 0087)." };
    return { ok: false as const, status: 500, error: "Couldn't read items. Try again." };
  }
  const shape = (r: Record<string, unknown>): RundownStateItem => ({
    key: r.key as string,
    section: r.section as string,
    title: r.title as string,
    status: r.status as string,
    done_at: (r.done_at as string | null) ?? null,
    // A Planner user id is only "josh" to Grok; the id itself means nothing to it.
    done_by: r.done_source === "planner" ? "josh" : ((r.done_by as string | null) ?? null),
    done_source: (r.done_source as string | null) ?? null,
    last_run_date: r.last_run_date as string,
    on_planner: Boolean(r.planner_task_id),
    sent_at: (r.sent_at as string | null) ?? null,
  });
  return {
    ok: true as const,
    since: sinceIso,
    open: (open.data ?? []).map(shape),
    finished: (finished.data ?? []).map(shape),
  };
}
