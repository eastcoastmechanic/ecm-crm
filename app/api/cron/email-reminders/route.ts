import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resend, RESEND_FROM_EMAIL } from "@/lib/resend";

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(n: number) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

type CustomerContact = { name: string | null; email: string | null } | null;

async function sendOverdueInvoiceReminders() {
  const { data: invoices, error } = await supabase
    .from("documents")
    .select("id, doc_number, total, due_date, last_reminder_sent_at, customers(name, email)")
    .eq("type", "invoice")
    .eq("status", "sent")
    .lt("due_date", todayISODate())
    .or(`last_reminder_sent_at.is.null,last_reminder_sent_at.lte.${daysAgoISO(7)}`);

  if (error) return { sent: 0, errors: [error.message] };

  const errors: string[] = [];
  let sent = 0;

  for (const invoice of invoices ?? []) {
    const customer = invoice.customers as unknown as CustomerContact;
    const email = customer?.email;
    if (!email) continue;

    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      to: email,
      subject: `Reminder: Invoice ${invoice.doc_number ?? ""} is past due`,
      text: `Hi ${customer?.name ?? ""},\n\nThis is a friendly reminder that invoice ${invoice.doc_number ?? ""} for ${formatPrice(
        invoice.total ?? 0
      )} was due on ${invoice.due_date}. If you've already paid, please disregard this message.\n\nLet us know if you have any questions.\n\nEast Coast Mechanical`,
    });

    if (sendError) {
      errors.push(`invoice ${invoice.id}: ${sendError.message}`);
      continue;
    }

    await supabase
      .from("documents")
      .update({ last_reminder_sent_at: new Date().toISOString() })
      .eq("id", invoice.id);
    sent++;
  }

  return { sent, errors };
}

async function sendContractRenewalNotices() {
  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);

  const { data: contracts, error } = await supabase
    .from("service_contracts")
    .select("id, plan_name, end_date, customers(name, email)")
    .eq("status", "active")
    .gte("end_date", todayISODate())
    .lte("end_date", in30Days.toISOString().slice(0, 10))
    .is("renewal_reminder_sent_at", null);

  if (error) return { sent: 0, errors: [error.message] };

  const errors: string[] = [];
  let sent = 0;

  for (const contract of contracts ?? []) {
    const customer = contract.customers as unknown as CustomerContact;
    const email = customer?.email;
    if (!email) continue;

    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      to: email,
      subject: `Your service plan renews soon`,
      text: `Hi ${customer?.name ?? ""},\n\nYour service plan${
        contract.plan_name ? ` (${contract.plan_name})` : ""
      } renews on ${contract.end_date}. Reach out if you'd like to review your coverage before then.\n\nEast Coast Mechanical`,
    });

    if (sendError) {
      errors.push(`contract ${contract.id}: ${sendError.message}`);
      continue;
    }

    await supabase
      .from("service_contracts")
      .update({ renewal_reminder_sent_at: new Date().toISOString() })
      .eq("id", contract.id);
    sent++;
  }

  return { sent, errors };
}

async function sendJobFollowUps() {
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, completed_at, customers(name, email), properties(address)")
    .eq("status", "complete")
    .lte("completed_at", daysAgoISO(1))
    .gte("completed_at", daysAgoISO(2))
    .is("follow_up_sent_at", null);

  if (error) return { sent: 0, errors: [error.message] };

  const errors: string[] = [];
  let sent = 0;

  for (const job of jobs ?? []) {
    const customer = job.customers as unknown as CustomerContact;
    const property = job.properties as unknown as { address: string | null } | null;
    const email = customer?.email;
    if (!email) continue;

    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      to: email,
      subject: `How did we do?`,
      text: `Hi ${customer?.name ?? ""},\n\nThanks for choosing East Coast Mechanical for your recent service${
        property?.address ? ` at ${property.address}` : ""
      }. Let us know if everything's working as expected, or if there's anything else we can help with.\n\nEast Coast Mechanical`,
    });

    if (sendError) {
      errors.push(`job ${job.id}: ${sendError.message}`);
      continue;
    }

    await supabase
      .from("jobs")
      .update({ follow_up_sent_at: new Date().toISOString() })
      .eq("id", job.id);
    sent++;
  }

  return { sent, errors };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [invoiceReminders, contractRenewals, jobFollowUps] = await Promise.all([
    sendOverdueInvoiceReminders(),
    sendContractRenewalNotices(),
    sendJobFollowUps(),
  ]);

  return NextResponse.json({ invoiceReminders, contractRenewals, jobFollowUps });
}
