import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resend, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from "@/lib/resend";
import { stripe } from "@/lib/stripe";
import { movePlannerTaskForJob, createPlannerTask } from "@/lib/planner-connector";

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
    .select("id, doc_number, total, due_date, last_reminder_sent_at, job_id, customers(name, email)")
    .eq("type", "invoice")
    .eq("status", "sent")
    .lt("due_date", todayISODate())
    .or(`last_reminder_sent_at.is.null,last_reminder_sent_at.lte.${daysAgoISO(7)}`);

  if (error) return { sent: 0, errors: [error.message] };

  const errors: string[] = [];
  let sent = 0;

  for (const invoice of invoices ?? []) {
    // Every row here is overdue by the query above -- flag the job's Planner
    // card regardless of whether an email goes out, since a missing customer
    // email shouldn't also hide it from the internal board.
    if (invoice.job_id) {
      await movePlannerTaskForJob(invoice.job_id, "needs_attention");
    }

    const customer = invoice.customers as unknown as CustomerContact;
    const email = customer?.email;
    if (!email) continue;

    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      replyTo: RESEND_REPLY_TO,
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
      replyTo: RESEND_REPLY_TO,
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

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://ecm-crm.vercel.app";

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
      replyTo: RESEND_REPLY_TO,
      to: email,
      subject: `How did we do?`,
      text: `Hi ${customer?.name ?? ""},\n\nThanks for choosing East Coast Mechanical for your recent service${
        property?.address ? ` at ${property.address}` : ""
      }. Mind taking 30 seconds to tell us how it went?\n\n${APP_URL}/survey/${job.id}\n\nEast Coast Mechanical`,
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

async function sendStaleEstimateFollowUps() {
  const { data: estimates, error } = await supabase
    .from("documents")
    .select("id, doc_number, total, last_reminder_sent_at, customers(name, email)")
    .eq("type", "estimate")
    .eq("status", "sent")
    .lte("created_at", daysAgoISO(5))
    .or(`last_reminder_sent_at.is.null,last_reminder_sent_at.lte.${daysAgoISO(7)}`);

  if (error) return { sent: 0, errors: [error.message] };

  const errors: string[] = [];
  let sent = 0;

  for (const estimate of estimates ?? []) {
    const customer = estimate.customers as unknown as CustomerContact;

    // First time this estimate shows up stale, flag it for staff too --
    // the customer email below repeats every 7 days, but one Planner card
    // per estimate is enough; it isn't going anywhere until someone acts on it.
    if (!estimate.last_reminder_sent_at) {
      await createPlannerTask({
        title: `Follow up: ${customer?.name ?? "Customer"} — estimate ${estimate.doc_number ?? ""}`,
        notes: `Sitting at "sent" with no response for 5+ days.`,
        bucket: "tasks",
      });
    }

    const email = customer?.email;
    if (!email) continue;

    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      replyTo: RESEND_REPLY_TO,
      to: email,
      subject: `Following up on estimate ${estimate.doc_number ?? ""}`,
      text: `Hi ${customer?.name ?? ""},\n\nJust checking in on estimate ${estimate.doc_number ?? ""} for ${formatPrice(
        estimate.total ?? 0
      )}. Let us know if you have any questions or would like to move forward — happy to help either way.\n\nEast Coast Mechanical`,
    });

    if (sendError) {
      errors.push(`estimate ${estimate.id}: ${sendError.message}`);
      continue;
    }

    await supabase
      .from("documents")
      .update({ last_reminder_sent_at: new Date().toISOString() })
      .eq("id", estimate.id);
    sent++;
  }

  return { sent, errors };
}

async function sendMassSaveStallAlerts() {
  const { data: rebates, error } = await supabase
    .from("documents")
    .select("id, doc_number, last_reminder_sent_at, customers(name, email)")
    .eq("type", "mass_save_rebate")
    .eq("status", "sent")
    .lte("created_at", daysAgoISO(14))
    .is("last_reminder_sent_at", null);

  if (error) return { flagged: 0, errors: [error.message] };

  const errors: string[] = [];
  let flagged = 0;

  // Internal-only -- Mass Save paperwork is ECM's process, not the
  // customer's, so this is a Planner card, not an email.
  for (const rebate of rebates ?? []) {
    const customer = rebate.customers as unknown as CustomerContact;

    await createPlannerTask({
      title: `Mass Save stalled: ${customer?.name ?? "Customer"} — ${rebate.doc_number ?? ""}`,
      notes: `Submitted 14+ days ago with no status update. Check on approval.`,
      bucket: "tasks",
    });

    const { error: updateError } = await supabase
      .from("documents")
      .update({ last_reminder_sent_at: new Date().toISOString() })
      .eq("id", rebate.id);
    if (updateError) {
      errors.push(`rebate ${rebate.id}: ${updateError.message}`);
      continue;
    }
    flagged++;
  }

  return { flagged, errors };
}

async function sendWarrantyAlerts() {
  const in60Days = new Date();
  in60Days.setDate(in60Days.getDate() + 60);

  const { data: items, error } = await supabase
    .from("equipment")
    .select("id, type, brand, model, warranty_expiration, properties(address, customers(name, email))")
    .not("warranty_expiration", "is", null)
    .gte("warranty_expiration", todayISODate())
    .lte("warranty_expiration", in60Days.toISOString().slice(0, 10))
    .is("warranty_alert_sent_at", null);

  if (error) return { sent: 0, errors: [error.message] };

  const errors: string[] = [];
  let sent = 0;

  for (const item of items ?? []) {
    const property = item.properties as unknown as {
      address: string | null;
      customers: { name: string | null; email: string | null }[] | null;
    } | null;
    const customer = property?.customers?.[0];
    const email = customer?.email;
    if (!email) continue;

    const label = [item.brand, item.model, item.type].filter(Boolean).join(" ") || "your equipment";

    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      replyTo: RESEND_REPLY_TO,
      to: email,
      subject: `Your warranty is expiring soon`,
      text: `Hi ${customer?.name ?? ""},\n\nThe manufacturer warranty on ${label}${
        property?.address ? ` at ${property.address}` : ""
      } expires on ${item.warranty_expiration}. If anything's been off with it, now's a good time to have us take a look before coverage runs out.\n\nEast Coast Mechanical`,
    });

    if (sendError) {
      errors.push(`equipment ${item.id}: ${sendError.message}`);
      continue;
    }

    await supabase
      .from("equipment")
      .update({ warranty_alert_sent_at: new Date().toISOString() })
      .eq("id", item.id);
    sent++;
  }

  return { sent, errors };
}

async function sendMaintenancePlanCharges() {
  const in7Days = new Date();
  in7Days.setDate(in7Days.getDate() + 7);

  const { data: contracts, error } = await supabase
    .from("service_contracts")
    .select("id, plan_name, end_date, customers(id, name, email, stripe_customer_id)")
    .eq("status", "active")
    .gte("end_date", todayISODate())
    .lte("end_date", in7Days.toISOString().slice(0, 10))
    .is("auto_billed_at", null);

  if (error) return { charged: 0, skipped: 0, errors: [error.message] };

  const errors: string[] = [];
  let charged = 0;
  let skipped = 0;

  for (const contract of contracts ?? []) {
    const customer = (contract.customers as unknown as
      | { id: string; name: string | null; email: string | null; stripe_customer_id: string | null }[]
      | null)?.[0];

    if (!customer?.stripe_customer_id) {
      skipped++;
      continue;
    }

    try {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customer.stripe_customer_id,
        type: "card",
      });
      const paymentMethodId = paymentMethods.data[0]?.id;
      if (!paymentMethodId) {
        skipped++;
        continue;
      }

      // Renewal price isn't tracked per-contract yet — this charges a
      // placeholder amount matching the flat HVAC Basic Plan price in the
      // price book. Revisit once contracts carry their own renewal price.
      await stripe.paymentIntents.create({
        amount: 29900,
        currency: "usd",
        customer: customer.stripe_customer_id,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: `Service plan renewal${contract.plan_name ? ` — ${contract.plan_name}` : ""}`,
      });

      await supabase
        .from("service_contracts")
        .update({
          auto_billed_at: new Date().toISOString(),
          stripe_payment_method_id: paymentMethodId,
        })
        .eq("id", contract.id);
      charged++;
    } catch (err) {
      errors.push(`contract ${contract.id}: ${err instanceof Error ? err.message : "charge failed"}`);
    }
  }

  return { charged, skipped, errors };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [
    invoiceReminders,
    contractRenewals,
    jobFollowUps,
    estimateFollowUps,
    massSaveStallAlerts,
    warrantyAlerts,
    maintenancePlanCharges,
  ] = await Promise.all([
    sendOverdueInvoiceReminders(),
    sendContractRenewalNotices(),
    sendJobFollowUps(),
    sendStaleEstimateFollowUps(),
    sendMassSaveStallAlerts(),
    sendWarrantyAlerts(),
    sendMaintenancePlanCharges(),
  ]);

  return NextResponse.json({
    invoiceReminders,
    contractRenewals,
    jobFollowUps,
    estimateFollowUps,
    massSaveStallAlerts,
    warrantyAlerts,
    maintenancePlanCharges,
  });
}
