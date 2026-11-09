import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { supabase } from "@/lib/supabase";
import { createInvoicePaymentLink } from "@/lib/payment-links";
import { finishServiceReport, sendServiceReportEmail, assignCustomer } from "@/app/(internal)/diagnostics/[id]/actions";
import { fieldBoardTools } from "./tools-field-board";
import {
  SERVICE_REPORT_LIST_SELECT,
  clampReportLimit,
  filterServiceReports,
  type ServiceReportRow,
} from "@/lib/service-report-list";

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
    const max = clampReportLimit(limit);
    // diagnostics has no customer_id: a report reaches its customer through its
    // equipment's property or its job. See lib/service-report-list.ts.
    let rows: ServiceReportRow[];
    if (customerId) {
      const [jobsRes, propsRes] = await Promise.all([
        supabase.from("jobs").select("id").eq("customer_id", customerId).limit(500),
        supabase.from("properties").select("id").eq("customer_id", customerId).limit(200),
      ]);
      if (jobsRes.error || propsRes.error) {
        return `Failed to list service reports: ${(jobsRes.error ?? propsRes.error)?.message}`;
      }
      const jobIds = (jobsRes.data ?? []).map((j) => j.id as string);
      const propertyIds = (propsRes.data ?? []).map((p) => p.id as string);
      let equipmentIds: string[] = [];
      if (propertyIds.length > 0) {
        const eqRes = await supabase.from("equipment").select("id").in("property_id", propertyIds).limit(500);
        if (eqRes.error) return `Failed to list service reports: ${eqRes.error.message}`;
        equipmentIds = (eqRes.data ?? []).map((e) => e.id as string);
      }
      if (jobIds.length === 0 && equipmentIds.length === 0) return "No service reports match that.";

      const queries = [];
      if (jobIds.length > 0) {
        queries.push(supabase.from("diagnostics").select(SERVICE_REPORT_LIST_SELECT).in("job_id", jobIds).order("created_at", { ascending: false }).limit(max));
      }
      if (equipmentIds.length > 0) {
        queries.push(
          supabase.from("diagnostics").select(SERVICE_REPORT_LIST_SELECT).in("equipment_id", equipmentIds).order("created_at", { ascending: false }).limit(max)
        );
      }
      const results = await Promise.all(queries);
      const failed = results.find((r) => r.error);
      if (failed?.error) return `Failed to list service reports: ${failed.error.message}`;
      const byId = new Map<string, ServiceReportRow>();
      for (const r of results) for (const row of (r.data ?? []) as unknown as ServiceReportRow[]) byId.set(row.id, row);
      rows = [...byId.values()].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    } else {
      // Unassigned is worked out per row, so read a wider window and filter.
      const { data, error } = await supabase
        .from("diagnostics")
        .select(SERVICE_REPORT_LIST_SELECT)
        .order("created_at", { ascending: false })
        .limit(unassignedOnly ? 200 : max);
      if (error) return `Failed to list service reports: ${error.message}`;
      rows = (data ?? []) as unknown as ServiceReportRow[];
    }

    const listed = filterServiceReports(rows, { customerId, unassignedOnly, limit: max });
    if (listed.length === 0) return "No service reports match that.";
    return JSON.stringify(listed);
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
      const result = await assignCustomer(null, fd);
      if (result?.error) return `Failed to assign: ${result.error}`;
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
      const result = await finishServiceReport(null, fd);
      if (result?.error) return `Failed to finish service report: ${result.error}`;
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
      const result = await sendServiceReportEmail(null, fd);
      if (result?.error) return `Failed to send service report: ${result.error}`;
      return `Sent service report ${diagnosticId} to the customer.`;
    } catch (err) {
      return `Failed to send service report: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

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

const REFRIGERANTS = ["R-410A", "R-32", "R-454B", "R-22", "R-134a", "R-407C"] as const;
const OZ_PER_LB = 16;

const logRefrigerantTool = betaZodTool({
  name: "log_refrigerant",
  description:
    "Record refrigerant added to or recovered from a system, and any leak inspection or repair. EPA 608 requires this record for every charge and recovery.",
  inputSchema: z.object({
    action: z.enum(["added", "recovered"]),
    refrigerantType: z.enum(REFRIGERANTS),
    amountLb: z.number().optional(),
    amountOz: z.number().optional(),
    jobId: z.string().optional(),
    equipmentId: z.string().optional(),
    customerId: z.string().optional(),
    cylinderId: z.string().optional(),
    leakInspection: z.boolean().optional(),
    leakFound: z.boolean().optional(),
    leakLocation: z.string().optional(),
    leakRepaired: z.boolean().optional(),
    techName: z.string().optional(),
    notes: z.string().optional(),
  }),
  run: async (input) => {
    const oz =
      input.amountOz != null ? input.amountOz : input.amountLb != null ? input.amountLb * OZ_PER_LB : null;
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
  description: "Read the refrigerant handling log — by job, by equipment, or over a date range.",
  inputSchema: z.object({
    jobId: z.string().optional(),
    equipmentId: z.string().optional(),
    since: z.string().optional(),
    until: z.string().optional(),
    unrepairedLeaksOnly: z.boolean().optional(),
    limit: z.number().optional(),
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

    const added = data.filter((r) => r.action === "added").reduce((sum, r) => sum + Number(r.amount_oz ?? 0), 0);
    const recovered = data.filter((r) => r.action === "recovered").reduce((sum, r) => sum + Number(r.amount_oz ?? 0), 0);
    const lb = (oz: number) => Math.round((oz / OZ_PER_LB) * 100) / 100;

    return JSON.stringify({
      entries: data,
      totals: { added_lb: lb(added), recovered_lb: lb(recovered) },
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
  ...fieldBoardTools,
];
