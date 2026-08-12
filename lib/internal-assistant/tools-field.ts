import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { supabase } from "@/lib/supabase";
import { createInvoicePaymentLink } from "@/lib/payment-links";
import { finishServiceReport, sendServiceReportEmail, assignCustomer } from "@/app/(internal)/diagnostics/[id]/actions";

/**
 * Field work: service reports (diagnostics), install reports, and getting paid.
 *
 * Same rule as tools-ops.ts — wrap the server action the UI already calls
 * rather than reimplementing it, so validation and revalidation stay in one
 * place.
 */

// -------------------------------------------------- service reports

const listServiceReportsTool = betaZodTool({
  name: "list_service_reports",
  description:
    "List service reports (diagnostics) — the write-ups techs produce on a call. Use to find one before finishing or sending it, or to answer 'what did we find at X'. Unassigned ones have no customer attached yet.",
  inputSchema: z.object({
    customerId: z.string().optional().describe("Limit to one customer"),
    unassignedOnly: z.boolean().optional().describe("Only reports with no customer attached yet"),
    limit: z.number().optional().describe("Default 20"),
  }),
  run: async ({ customerId, unassignedOnly, limit }) => {
    let q = supabase
      .from("diagnostics")
      .select(
        "id, created_at, technician_name, symptom, diagnosis, invoice_document_id, customer_id, equipment(type, brand, model)"
      )
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (customerId) q = q.eq("customer_id", customerId);
    if (unassignedOnly) q = q.is("customer_id", null);

    const { data, error } = await q;
    if (error) return `Failed to list service reports: ${error.message}`;
    if (!data || data.length === 0) return "No service reports match that.";
    return JSON.stringify(data);
  },
});

const assignServiceReportTool = betaZodTool({
  name: "assign_service_report",
  description:
    "Attach a service report to a customer (and optionally a property/equipment). A report must have a customer before it can be invoiced. Use find_customer and list_properties to get the ids.",
  inputSchema: z.object({
    diagnosticId: z.string(),
    customerId: z.string(),
    propertyId: z.string().optional(),
    equipmentId: z.string().optional(),
  }),
  run: async ({ diagnosticId, customerId, propertyId, equipmentId }) => {
    const fd = new FormData();
    fd.set("diagnostic_id", diagnosticId);
    fd.set("customer_id", customerId);
    if (propertyId) fd.set("property_id", propertyId);
    if (equipmentId) fd.set("equipment_id", equipmentId);
    try {
      await assignCustomer(fd);
      return `Service report ${diagnosticId} is now attached to customer ${customerId}.`;
    } catch (err) {
      return `Failed to assign: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

const finishServiceReportTool = betaZodTool({
  name: "finish_service_report",
  description:
    "Close out a service call. Logs start/end time (tracked hours are computed from them) and can raise a real draft invoice from the confirmed parts plus labour. The report must already have a customer — use assign_service_report first if it doesn't.",
  inputSchema: z.object({
    diagnosticId: z.string(),
    timeStartedAt: z.string().optional().describe("Local datetime, e.g. 2026-08-08T09:00"),
    timeEndedAt: z.string().optional().describe("Local datetime, e.g. 2026-08-08T11:30"),
    createInvoice: z.boolean().optional().describe("Raise a draft invoice from parts used + labour"),
  }),
  run: async ({ diagnosticId, timeStartedAt, timeEndedAt, createInvoice }) => {
    const fd = new FormData();
    fd.set("diagnostic_id", diagnosticId);
    if (timeStartedAt) fd.set("time_started_at", timeStartedAt);
    if (timeEndedAt) fd.set("time_ended_at", timeEndedAt);
    if (createInvoice) fd.set("create_invoice", "on");
    try {
      await finishServiceReport(fd);
      return createInvoice
        ? `Finished service report ${diagnosticId} and raised a draft invoice. Review it before sending.`
        : `Finished service report ${diagnosticId}.`;
    } catch (err) {
      return `Failed to finish service report: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

const sendServiceReportTool = betaZodTool({
  name: "send_service_report",
  description:
    "Email a finished service report to the customer as a PDF. Confirm with the tech first — this reaches the customer. The customer needs an email on file.",
  inputSchema: z.object({
    diagnosticId: z.string(),
  }),
  run: async ({ diagnosticId }) => {
    const fd = new FormData();
    fd.set("id", diagnosticId);
    try {
      await sendServiceReportEmail(fd);
      return `Sent service report ${diagnosticId} to the customer.`;
    } catch (err) {
      return `Failed to send service report: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

// -------------------------------------------------- install reports

const listInstallReportsTool = betaZodTool({
  name: "list_install_reports",
  description:
    "List install reports — the commissioning write-ups (lineset charge, nitrogen pressure test, vacuum/decay, startup checklist, sign-off). Use to check whether a job was commissioned and what was recorded. Creating one is a form the tech fills on site, not something to do from chat.",
  inputSchema: z.object({
    customerId: z.string().optional(),
    limit: z.number().optional().describe("Default 20"),
  }),
  run: async ({ customerId, limit }) => {
    let q = supabase
      .from("install_reports")
      .select(
        "id, created_at, tech_name, system_type, brand, model, serial, refrigerant_type, lineset_total_ft, customer_id, job_id"
      )
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (customerId) q = q.eq("customer_id", customerId);

    const { data, error } = await q;
    if (error) return `Failed to list install reports: ${error.message}`;
    if (!data || data.length === 0) return "No install reports match that.";
    return JSON.stringify(data);
  },
});

// -------------------------------------------------- getting paid

const createPaymentLinkTool = betaZodTool({
  name: "create_payment_link",
  description:
    "Generate a Stripe checkout link for an unpaid invoice, to text or email to the customer. Returns the URL — it does not send anything itself. Only works on invoices (not estimates or proposals) that have an amount due and aren't already paid. When it's paid, the invoice is marked paid automatically.",
  inputSchema: z.object({
    documentId: z.string().describe("The invoice's document id — use list_documents to find it"),
  }),
  run: async ({ documentId }) => {
    try {
      const { url, docNumber, total } = await createInvoicePaymentLink(documentId);
      const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(total);
      return `Payment link for invoice ${docNumber} (${amount}):\n${url}`;
    } catch (err) {
      return `Couldn't create a payment link: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

// ------------------------------------------------ refrigerant / EPA 608

const REFRIGERANTS = ["R-410A", "R-32", "R-454B", "R-22", "R-134a", "R-407C"] as const;

const OZ_PER_LB = 16;

const logRefrigerantTool = betaZodTool({
  name: "log_refrigerant",
  description:
    "Record refrigerant added to or recovered from a system, and any leak inspection or repair. EPA 608 requires this record for every charge and recovery. Use it whenever a tech says they added or took out refrigerant — 'put two pounds of 410 in the Hutchinson unit', 'recovered 3 lb off the roof unit'. Get jobId from list_jobs and equipmentId from list_equipment where possible; both are optional but a log entry with neither is hard to defend in an audit.",
  inputSchema: z.object({
    action: z.enum(["added", "recovered"]),
    refrigerantType: z.enum(REFRIGERANTS),
    amountLb: z.number().optional().describe("Amount in pounds, if the tech said pounds"),
    amountOz: z.number().optional().describe("Amount in ounces, if the tech said ounces"),
    jobId: z.string().optional(),
    equipmentId: z.string().optional(),
    customerId: z.string().optional(),
    cylinderId: z.string().optional().describe("Cylinder/bottle serial or tag it came from or went into"),
    leakInspection: z.boolean().optional().describe("True if a leak inspection was performed"),
    leakFound: z.boolean().optional(),
    leakLocation: z.string().optional(),
    leakRepaired: z.boolean().optional(),
    techName: z.string().optional(),
    notes: z.string().optional(),
  }),
  run: async (input) => {
    const oz =
      input.amountOz != null
        ? input.amountOz
        : input.amountLb != null
          ? input.amountLb * OZ_PER_LB
          : null;
    if (oz === null) return "How much? Give the amount in pounds or ounces.";
    if (oz < 0) return "Amount can't be negative — use action 'recovered' for refrigerant coming out.";

    const { data, error } = await supabase
      .from("refrigerant_log")
      .insert({
        action: input.action,
        refrigerant_type: input.refrigerantType,
        amount_oz: Math.round(oz * 100) / 100,
        job_id: input.jobId ?? null,
        equipment_id: input.equipmentId ?? null,
        customer_id: input.customerId ?? null,
        cylinder_id: input.cylinderId ?? null,
        leak_inspection: input.leakInspection ?? false,
        leak_found: input.leakFound ?? false,
        leak_location: input.leakLocation ?? null,
        leak_repaired: input.leakRepaired ?? false,
        tech_name: input.techName ?? null,
        notes: input.notes ?? null,
      })
      .select("id")
      .single();
    if (error) return `Failed to log refrigerant: ${error.message}`;

    const lb = Math.round((oz / OZ_PER_LB) * 100) / 100;
    const leak = input.leakFound
      ? ` Leak noted${input.leakLocation ? ` at ${input.leakLocation}` : ""}${input.leakRepaired ? ", repaired" : ", NOT yet repaired"}.`
      : "";
    return `Logged ${lb} lb (${Math.round(oz * 100) / 100} oz) of ${input.refrigerantType} ${input.action} (id ${data.id}).${leak}`;
  },
});

const listRefrigerantLogTool = betaZodTool({
  name: "list_refrigerant_log",
  description:
    "Read the refrigerant handling log — by job, by equipment, or over a date range. Use for EPA 608 recordkeeping questions, 'how much 410 did we put in that unit', or to see whether a leak was ever repaired. Also totals the amounts so a recurring top-up shows up as the leak it probably is.",
  inputSchema: z.object({
    jobId: z.string().optional(),
    equipmentId: z.string().optional(),
    since: z.string().optional().describe("ISO date — only entries on/after this"),
    until: z.string().optional().describe("ISO date — only entries on/before this"),
    unrepairedLeaksOnly: z.boolean().optional().describe("Only entries with a leak found and not repaired"),
    limit: z.number().optional().describe("Default 50"),
  }),
  run: async ({ jobId, equipmentId, since, until, unrepairedLeaksOnly, limit }) => {
    let q = supabase
      .from("refrigerant_log")
      .select(
        "id, action, refrigerant_type, amount_oz, cylinder_id, leak_found, leak_location, leak_repaired, tech_name, performed_at, notes"
      )
      .order("performed_at", { ascending: false })
      .limit(limit ?? 50);

    if (jobId) q = q.eq("job_id", jobId);
    if (equipmentId) q = q.eq("equipment_id", equipmentId);
    if (since) q = q.gte("performed_at", since);
    if (until) q = q.lte("performed_at", until);
    if (unrepairedLeaksOnly) q = q.eq("leak_found", true).eq("leak_repaired", false);

    const { data, error } = await q;
    if (error) return `Failed to read the refrigerant log: ${error.message}`;
    if (!data || data.length === 0) return "No refrigerant log entries match that.";

    const added = data
      .filter((r) => r.action === "added")
      .reduce((sum, r) => sum + Number(r.amount_oz ?? 0), 0);
    const recovered = data
      .filter((r) => r.action === "recovered")
      .reduce((sum, r) => sum + Number(r.amount_oz ?? 0), 0);

    const lb = (oz: number) => Math.round((oz / OZ_PER_LB) * 100) / 100;

    return JSON.stringify({
      entries: data,
      totals: { added_lb: lb(added), recovered_lb: lb(recovered) },
      // Repeated top-ups on one system is the pattern worth naming out loud —
      // it's a leak the customer is paying for in refrigerant instead of repair.
      note:
        data.filter((r) => r.action === "added").length > 1 && equipmentId
          ? "This unit has been charged more than once — worth flagging as a probable leak rather than another top-up."
          : undefined,
    });
  },
});

export const fieldTools = [
  listServiceReportsTool,
  assignServiceReportTool,
  finishServiceReportTool,
  sendServiceReportTool,
  listInstallReportsTool,
  createPaymentLinkTool,
  logRefrigerantTool,
  listRefrigerantLogTool,
];
