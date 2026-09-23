import { supabase } from "@/lib/supabase";
import { getFieldBoardSheet } from "@/lib/field-board";

export type FieldSheetLine = {
  id: string;
  label: string;
  detail: string;
  stamp: string | null;
};

export type FieldSheetPayload = {
  printedAt: string;
  dateLabel: string;
  notes: string[];
  active: FieldSheetLine[];
  ongoing: FieldSheetLine[];
  tasks: FieldSheetLine[];
  toBill: FieldSheetLine[];
  toContact: FieldSheetLine[];
  leftover: FieldSheetLine[];
};

function relatedName(value: unknown) {
  if (!value) return null;
  if (Array.isArray(value)) return (value[0] as { name?: string | null } | undefined)?.name ?? null;
  return (value as { name?: string | null }).name ?? null;
}

function line(id: string, parts: (string | null | undefined)[], stamp: string | null, extra?: string | null): FieldSheetLine {
  return {
    id,
    label: parts.filter(Boolean).join(" · ") || id.slice(0, 8),
    detail: extra?.trim() || "",
    stamp,
  };
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatStamp(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function getFieldSheetPayload(): Promise<FieldSheetPayload> {
  const today = startOfToday();
  const notes: string[] = [];

  let sheet: Awaited<ReturnType<typeof getFieldBoardSheet>>;
  try {
    sheet = await getFieldBoardSheet();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Field sheet failed";
    notes.push(message);
    sheet = { jobs: [], tasks: [], events: [], field_board_url: "", crm_url: "" };
  }

  const jobs = sheet.jobs ?? [];
  const active: FieldSheetLine[] = [];
  const ongoing: FieldSheetLine[] = [];
  const leftover: FieldSheetLine[] = [];

  for (const job of jobs) {
    const stamp = formatStamp(job.scheduled_at);
    const row = line(
      job.id,
      [job.customer, job.address, job.status.replaceAll("_", " ")],
      stamp,
      job.notes
    );
    const scheduled = job.scheduled_at ? new Date(job.scheduled_at) : null;
    const hold = /hold/i.test(`${job.notes ?? ""} ${job.customer ?? ""}`);

    if (job.status === "in_progress") {
      active.push(row);
      continue;
    }
    if (job.status === "requested" || job.status === "scheduled") {
      if (hold || (scheduled && scheduled < today)) leftover.push(row);
      else ongoing.push(row);
    }
  }

  const tasks: FieldSheetLine[] = (sheet.tasks ?? []).map((task) =>
    line(task.id, [task.title], formatStamp(task.due_at ?? null), null)
  );

  const events = sheet.events ?? [];
  for (const event of events.slice(0, 6)) {
    notes.push([event.title, event.body].filter(Boolean).join(" — "));
  }

  const toContact: FieldSheetLine[] = events
    .filter((event) => /contact|call|text|needs-attention/i.test(`${event.board_status ?? ""} ${event.title ?? ""}`))
    .slice(0, 8)
    .map((event) => line(event.id, [event.title], formatStamp(event.created_at), event.body));

  const toBill: FieldSheetLine[] = [];
  const { data: invoices } = await supabase
    .from("square_invoices")
    .select("square_invoice_id, invoice_number, title, status, amount_due_cents, square_customer_name, customers(name)")
    .gt("amount_due_cents", 0)
    .order("square_created_at", { ascending: false })
    .limit(12);

  for (const invoice of invoices ?? []) {
    const due = typeof invoice.amount_due_cents === "number" ? (invoice.amount_due_cents / 100).toFixed(2) : null;
    toBill.push(
      line(
        invoice.square_invoice_id,
        [relatedName(invoice.customers) ?? invoice.square_customer_name, invoice.invoice_number, invoice.status],
        null,
        due ? `Due $${due}${invoice.title ? ` · ${invoice.title}` : ""}` : invoice.title
      )
    );
  }

  if (toBill.length === 0) {
    for (const job of jobs.filter((item) => item.status === "complete").slice(0, 6)) {
      toBill.push(line(job.id, [job.customer, job.address, "complete — confirm billed"], formatStamp(job.scheduled_at), job.notes));
    }
  }

  if (notes.length === 0) notes.push("No field notes yet today.");
  if (active.length === 0) notes.push("No job marked on site.");

  return {
    printedAt: new Date().toISOString(),
    dateLabel: today.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    notes,
    active,
    ongoing,
    tasks,
    toBill,
    toContact,
    leftover,
  };
}
