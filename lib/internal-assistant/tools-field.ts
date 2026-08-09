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

export const fieldTools = [
  listServiceReportsTool,
  assignServiceReportTool,
  finishServiceReportTool,
  sendServiceReportTool,
  listInstallReportsTool,
  createPaymentLinkTool,
];
