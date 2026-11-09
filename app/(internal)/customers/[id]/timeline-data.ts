import { supabase } from "@/lib/supabase";
import { chunk, fetchAllRows } from "@/lib/fetch-all";
import type {
  CampaignSendRow,
  ConversationRow,
  DocumentRow,
  JobNoteRow,
  JobRow,
  LogEntryRow,
  SquarePaymentRow,
  SurveyRow,
  TimelineSources,
} from "@/lib/customer-timeline";

type Loaded<T> = { data: T[]; error: string | null };

// Every source is read in full (paged past Supabase's silent 1000-row cap) and
// one failing table never stops the others: its name lands in `failed` and the
// page shows the rest.

async function byIds<T>(
  ids: string[],
  page: (ids: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<Loaded<T>> {
  if (ids.length === 0) return { data: [], error: null };
  const parts = await Promise.all(chunk(ids).map((part) => fetchAllRows<T>((from, to) => page(part, from, to))));
  return { data: parts.flatMap((p) => p.data), error: parts.find((p) => p.error)?.error ?? null };
}

async function safe<T>(load: () => Promise<Loaded<T>>): Promise<Loaded<T>> {
  try {
    return await load();
  } catch (err) {
    return { data: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadCustomerTimeline(customerId: string): Promise<{ sources: TimelineSources; failed: string[] }> {
  const [conversations, documents, jobs, campaignSends, squarePayments, customerLog] = await Promise.all([
    safe(() =>
      fetchAllRows<ConversationRow>((from, to) =>
        supabase
          .from("ai_conversations")
          .select("id, channel, created_at, updated_at, transcript")
          .eq("customer_id", customerId)
          .order("id")
          .range(from, to)
      )
    ),
    safe(() =>
      fetchAllRows<DocumentRow>((from, to) =>
        supabase
          .from("documents")
          .select(
            "id, doc_number, type, status, total, created_at, sent_at, signed_at, paid_at, payment_source, deposit_received_cents, deposit_received_at, deposit_method"
          )
          .eq("customer_id", customerId)
          .order("id")
          .range(from, to)
      )
    ),
    safe(() =>
      fetchAllRows<JobRow>((from, to) =>
        supabase
          .from("jobs")
          .select(
            "id, job_type, status, notes, created_via, created_at, scheduled_at, on_way_at, arrived_at, completed_at, review_request_sent_at, review_reminder_sent_at"
          )
          .eq("customer_id", customerId)
          .order("id")
          .range(from, to)
      )
    ),
    safe(() =>
      fetchAllRows<CampaignSendRow>((from, to) =>
        supabase
          .from("campaign_sends")
          .select("id, kind, channel, sent_at, error")
          .eq("customer_id", customerId)
          .order("id")
          .range(from, to)
      )
    ),
    safe(() =>
      fetchAllRows<SquarePaymentRow>((from, to) =>
        supabase
          .from("square_payments")
          .select("id, status, total_cents, source_type, square_created_at")
          .eq("customer_id", customerId)
          .order("id")
          .range(from, to)
      )
    ),
    safe(() =>
      fetchAllRows<LogEntryRow>((from, to) =>
        supabase
          .from("log_entries")
          .select("id, section, body, job_id, created_at")
          .eq("customer_id", customerId)
          .order("id")
          .range(from, to)
      )
    ),
  ]);

  const jobIds = jobs.data.map((j) => j.id);

  // Notes, surveys and log entries hang off the customer's jobs.
  const [jobNotes, surveys, jobLog] = jobs.error
    ? [null, null, null]
    : await Promise.all([
        safe(() =>
          byIds<JobNoteRow>(jobIds, (ids, from, to) =>
            supabase.from("job_notes").select("id, job_id, author_name, body, created_at").in("job_id", ids).order("id").range(from, to)
          )
        ),
        safe(() =>
          byIds<SurveyRow>(jobIds, (ids, from, to) =>
            supabase
              .from("satisfaction_surveys")
              .select("id, job_id, rating, comment, created_at")
              .in("job_id", ids)
              .order("id")
              .range(from, to)
          )
        ),
        safe(() =>
          byIds<LogEntryRow>(jobIds, (ids, from, to) =>
            supabase.from("log_entries").select("id, section, body, job_id, created_at").in("job_id", ids).order("id").range(from, to)
          )
        ),
      ]);

  const failed: string[] = [];
  const note = (name: string, result: Loaded<unknown> | null) => {
    if (result?.error) {
      console.error(`customer timeline: ${name} failed`, result.error);
      failed.push(name);
    }
  };
  note("texts and calls", conversations);
  note("documents", documents);
  note("jobs", jobs);
  note("campaign messages", campaignSends);
  note("Square payments", squarePayments);
  note("log entries", customerLog.error ? customerLog : jobLog);
  note("job notes", jobNotes);
  note("survey answers", surveys);
  if (jobs.error) failed.push("job notes, survey answers and job log entries (need jobs)");

  return {
    sources: {
      conversations: conversations.data,
      documents: documents.data,
      jobs: jobs.data,
      jobNotes: jobNotes?.data ?? [],
      logEntries: [...customerLog.data, ...(jobLog?.data ?? [])],
      surveys: surveys?.data ?? [],
      campaignSends: campaignSends.data,
      squarePayments: squarePayments.data,
    },
    failed,
  };
}
