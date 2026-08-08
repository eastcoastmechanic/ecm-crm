import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { supabase } from "@/lib/supabase";
import { updateJobStatus, rescheduleJob } from "@/app/(internal)/jobs/actions";
import { setLeadStage, addManualLead, dismissLead } from "@/app/(internal)/leads/actions";
import { adjustInventoryQty } from "@/app/(internal)/inventory/actions";
import { sendDocumentEmail } from "@/app/(internal)/documents/[id]/actions";

/**
 * Jobs, leads, inventory and document sending.
 *
 * Split out of tools.ts purely for size. Every one of these wraps a server
 * action the CRM UI already calls, so the assistant goes through the same
 * validation and revalidation path a human clicking the page would — no
 * second implementation to drift.
 */

// ---------------------------------------------------------------- jobs

const JOB_STATUSES = ["requested", "scheduled", "in_progress", "complete", "cancelled"] as const;

const listJobsTool = betaZodTool({
  name: "list_jobs",
  description:
    "List jobs — optionally for one customer, one status, or only upcoming ones. Use this to answer 'what's on the schedule', 'what's booked for X', or to get a jobId before updating or rescheduling.",
  inputSchema: z.object({
    customerId: z.string().optional().describe("Limit to one customer — use find_customer first"),
    status: z.enum(JOB_STATUSES).optional(),
    upcomingOnly: z.boolean().optional().describe("Only jobs scheduled from now on"),
    limit: z.number().optional().describe("Default 20"),
  }),
  run: async ({ customerId, status, upcomingOnly, limit }) => {
    let q = supabase
      .from("jobs")
      .select("id, scheduled_at, status, notes, tracked_hours, customers(name), properties(address)")
      .order("scheduled_at", { ascending: true })
      .limit(limit ?? 20);
    if (customerId) q = q.eq("customer_id", customerId);
    if (status) q = q.eq("status", status);
    if (upcomingOnly) q = q.gte("scheduled_at", new Date().toISOString());

    const { data, error } = await q;
    if (error) return `Failed to list jobs: ${error.message}`;
    if (!data || data.length === 0) return "No jobs match that.";
    return JSON.stringify(data);
  },
});

const scheduleJobTool = betaZodTool({
  name: "schedule_job",
  description:
    "Book a job for a customer at a date/time. Use find_customer for the customerId and list_properties for the propertyId. If the customer has exactly one property, use it; if they have several and the tech didn't say which, ask.",
  inputSchema: z.object({
    customerId: z.string(),
    propertyId: z.string().optional(),
    scheduledAt: z.string().describe("ISO 8601 datetime, e.g. 2026-08-12T09:00:00-04:00"),
    notes: z.string().optional().describe("What the visit is for"),
  }),
  run: async ({ customerId, propertyId, scheduledAt, notes }) => {
    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) return `Couldn't read "${scheduledAt}" as a date/time.`;

    const { data, error } = await supabase
      .from("jobs")
      .insert({
        customer_id: customerId,
        property_id: propertyId ?? null,
        scheduled_at: when.toISOString(),
        status: "scheduled",
        notes: notes ?? null,
        created_via: "manual",
      })
      .select("id")
      .single();
    if (error) return `Failed to schedule job: ${error.message}`;
    return `Scheduled job ${data.id} for ${when.toLocaleString("en-US", { timeZone: "America/New_York" })} ET.`;
  },
});

const updateJobStatusTool = betaZodTool({
  name: "update_job_status",
  description:
    "Move a job to a new status — e.g. mark it complete or cancelled. Use list_jobs to get the jobId. Marking complete stamps the completion time.",
  inputSchema: z.object({
    jobId: z.string(),
    status: z.enum(JOB_STATUSES),
  }),
  run: async ({ jobId, status }) => {
    const fd = new FormData();
    fd.set("id", jobId);
    fd.set("status", status);
    try {
      await updateJobStatus(fd);
      return `Job ${jobId} is now "${status}".`;
    } catch (err) {
      return `Failed to update job: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

const rescheduleJobTool = betaZodTool({
  name: "reschedule_job",
  description: "Move an existing job to a different date/time. Use list_jobs to get the jobId.",
  inputSchema: z.object({
    jobId: z.string(),
    scheduledAt: z.string().describe("New ISO 8601 datetime"),
  }),
  run: async ({ jobId, scheduledAt }) => {
    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) return `Couldn't read "${scheduledAt}" as a date/time.`;
    try {
      await rescheduleJob(jobId, when.toISOString());
      return `Moved job ${jobId} to ${when.toLocaleString("en-US", { timeZone: "America/New_York" })} ET.`;
    } catch (err) {
      return `Failed to reschedule: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

// ---------------------------------------------------------------- leads

const LEAD_STATUSES = ["new", "contacted", "quoted", "won", "lost", "dismissed"] as const;

const listLeadsTool = betaZodTool({
  name: "list_leads",
  description:
    "List sales leads — from Lead Radar sweeps, MLS imports, or added by hand. Use to answer 'what leads do I have', 'who haven't I called', or to get a leadId before updating one.",
  inputSchema: z.object({
    status: z.enum(LEAD_STATUSES).optional(),
    town: z.string().optional(),
    limit: z.number().optional().describe("Default 25"),
  }),
  run: async ({ status, town, limit }) => {
    let q = supabase
      .from("leads")
      .select("id, contact_name, phone_number, email, town, address, status, source, summary, urgency_score, created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 25);
    if (status) q = q.eq("status", status);
    if (town) q = q.ilike("town", `%${town}%`);

    const { data, error } = await q;
    if (error) return `Failed to list leads: ${error.message}`;
    if (!data || data.length === 0) return "No leads match that.";
    return JSON.stringify(data);
  },
});

const setLeadStageTool = betaZodTool({
  name: "set_lead_stage",
  description:
    "Move a lead through the pipeline — contacted, quoted, won, lost. Use list_leads to get the leadId.",
  inputSchema: z.object({
    leadId: z.string(),
    status: z.enum(LEAD_STATUSES),
  }),
  run: async ({ leadId, status }) => {
    const fd = new FormData();
    fd.set("id", leadId);
    fd.set("status", status);
    try {
      if (status === "dismissed") await dismissLead(fd);
      else await setLeadStage(fd);
      return `Lead ${leadId} is now "${status}".`;
    } catch (err) {
      return `Failed to update lead: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

const addLeadTool = betaZodTool({
  name: "add_lead",
  description:
    "Add a lead by hand — someone who called, a referral, a door-knock. For a customer who already exists, add a job instead.",
  inputSchema: z.object({
    contactName: z.string(),
    phoneNumber: z.string().optional(),
    email: z.string().optional(),
    town: z.string().optional(),
    address: z.string().optional(),
    summary: z.string().optional().describe("What they need"),
  }),
  run: async ({ contactName, phoneNumber, email, town, address, summary }) => {
    const fd = new FormData();
    fd.set("contact_name", contactName);
    if (phoneNumber) fd.set("phone_number", phoneNumber);
    if (email) fd.set("email", email);
    if (town) fd.set("town", town);
    if (address) fd.set("address", address);
    if (summary) fd.set("summary", summary);
    try {
      await addManualLead(fd);
      return `Added lead for ${contactName}.`;
    } catch (err) {
      return `Failed to add lead: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

// ------------------------------------------------------------- inventory

const listInventoryTool = betaZodTool({
  name: "list_inventory",
  description:
    "Check truck/shop stock. Use for 'do we have X', or with lowOnly to see what needs reordering.",
  inputSchema: z.object({
    query: z.string().optional().describe("Filter by item name"),
    lowOnly: z.boolean().optional().describe("Only items at or below their reorder threshold"),
  }),
  run: async ({ query, lowOnly }) => {
    const { data, error } = await supabase
      .from("inventory_items")
      .select("id, qty_on_hand, reorder_threshold, price_book_items(name, category)")
      .limit(200);
    if (error) return `Failed to read inventory: ${error.message}`;

    let rows = data ?? [];
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter((r) => {
        const item = r.price_book_items as { name?: string; category?: string } | null;
        return `${item?.name ?? ""} ${item?.category ?? ""}`.toLowerCase().includes(q);
      });
    }
    if (lowOnly) {
      rows = rows.filter((r) => r.reorder_threshold !== null && r.qty_on_hand <= r.reorder_threshold);
    }
    if (rows.length === 0) return "No inventory items match that.";
    return JSON.stringify(rows);
  },
});

const adjustInventoryTool = betaZodTool({
  name: "adjust_inventory",
  description:
    "Set an inventory item's quantity on hand — after a count, or after pulling parts for a job. Use list_inventory to get the itemId. This sets an absolute quantity, not a delta.",
  inputSchema: z.object({
    itemId: z.string(),
    qtyOnHand: z.number().describe("The new absolute count"),
  }),
  run: async ({ itemId, qtyOnHand }) => {
    const fd = new FormData();
    fd.set("id", itemId);
    fd.set("qty_on_hand", String(qtyOnHand));
    try {
      await adjustInventoryQty(fd);
      return `Inventory item ${itemId} set to ${qtyOnHand} on hand.`;
    } catch (err) {
      return `Failed to adjust inventory: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

// ------------------------------------------------------------ documents

const sendDocumentTool = betaZodTool({
  name: "send_document",
  description:
    "Email a finished estimate, invoice, proposal, assessment or warranty to the customer as a PDF. Use list_documents to get the documentId. The customer must have an email on file — if they don't, add one with update_customer first. Confirm with the tech before sending; this reaches the customer directly.",
  inputSchema: z.object({
    documentId: z.string(),
  }),
  run: async ({ documentId }) => {
    const fd = new FormData();
    fd.set("id", documentId);
    try {
      await sendDocumentEmail(fd);
      return `Sent document ${documentId} to the customer.`;
    } catch (err) {
      return `Failed to send: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

export const opsTools = [
  listJobsTool,
  scheduleJobTool,
  updateJobStatusTool,
  rescheduleJobTool,
  listLeadsTool,
  setLeadStageTool,
  addLeadTool,
  listInventoryTool,
  adjustInventoryTool,
  sendDocumentTool,
];
