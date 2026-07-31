import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { supabase } from "@/lib/supabase";
import { generateDocumentForCustomer } from "@/lib/document-generation";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

const addCustomerTool = betaZodTool({
  name: "add_customer",
  description: "Add a new customer to the CRM.",
  inputSchema: z.object({
    name: z.string().describe("Customer's full name"),
    phone: z.string().optional().describe("Phone number"),
    email: z.string().optional().describe("Email address"),
    notes: z.string().optional().describe("Any notes about this customer"),
  }),
  run: async ({ name, phone, email, notes }) => {
    const { data, error } = await supabase
      .from("customers")
      .insert({ name, phone: phone || null, email: email || null, notes: notes || null })
      .select("id")
      .single();
    if (error) return `Failed to add customer: ${error.message}`;
    return `Added customer "${name}" (id ${data.id}).`;
  },
});

const findCustomerTool = betaZodTool({
  name: "find_customer",
  description: "Look up a customer by name to get their id before creating a document or task for them.",
  inputSchema: z.object({
    name: z.string().describe("Full or partial customer name to search for"),
  }),
  run: async ({ name }) => {
    const { data } = await supabase.from("customers").select("id, name, phone, email").ilike("name", `%${name}%`).limit(5);
    if (!data || data.length === 0) return `No customer found matching "${name}".`;
    return JSON.stringify(data);
  },
});

function buildDocumentTool(type: "estimate" | "invoice" | "proposal") {
  return betaZodTool({
    name: `create_${type}`,
    description: `Generate a real ${type} using the price book and Claude, for an existing or brand-new customer. Creates an actual draft ${type} in the CRM.`,
    inputSchema: z.object({
      customerId: z.string().optional().describe("Existing customer id, from find_customer"),
      customerName: z.string().optional().describe("Required only if this is a brand-new customer"),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional().describe("Service address, if known"),
      jobDescription: z.string().describe("What the job involves, in enough detail to select price book items"),
    }),
    run: async ({ customerId, customerName, phone, email, address, jobDescription }) => {
      if (!customerId && !customerName) {
        return "Need either an existing customerId (use find_customer) or a customerName for a new customer.";
      }
      try {
        const results = await generateDocumentForCustomer({
          customerId,
          customerName,
          phone,
          email,
          address,
          type,
          rawRequest: jobDescription,
        });
        const lines = results.map(
          (r) =>
            `${r.docNumber}${r.optionLabel ? ` (${r.optionLabel})` : ""} — Good ${formatMoney(
              r.totals.good
            )} / Better ${formatMoney(r.totals.better)} / Best ${formatMoney(r.totals.best)}. /documents/${r.documentId}`
        );
        return results.length === 1
          ? `Created ${lines[0]}`
          : `The job described ${results.length} separate options, so I created one ${type} per option, each priced on its own:\n${lines.join("\n")}`;
      } catch (err) {
        return `Failed to create ${type}: ${err instanceof Error ? err.message : "unknown error"}`;
      }
    },
  });
}

const addTaskTool = betaZodTool({
  name: "add_task",
  description: "Add a task/to-do for the owner, optionally with a due date and linked to a customer.",
  inputSchema: z.object({
    title: z.string().describe("Short task title"),
    notes: z.string().optional().describe("Additional detail"),
    dueDate: z.string().optional().describe("Due date, format YYYY-MM-DD"),
    customerId: z.string().optional().describe("Related customer id, if any"),
  }),
  run: async ({ title, notes, dueDate, customerId }) => {
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title,
        notes: notes || null,
        due_at: dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : null,
        customer_id: customerId || null,
        created_via: "ai_chat",
      })
      .select("id")
      .single();
    if (error) return `Failed to add task: ${error.message}`;
    return `Added task "${title}"${dueDate ? ` due ${dueDate}` : ""} (id ${data.id}).`;
  },
});

const listOpenTasksTool = betaZodTool({
  name: "list_open_tasks",
  description: "List open (not completed) tasks, soonest due first.",
  inputSchema: z.object({}),
  run: async () => {
    const { data } = await supabase
      .from("tasks")
      .select("id, title, notes, due_at")
      .is("completed_at", null)
      .order("due_at", { ascending: true, nullsFirst: false });
    if (!data || data.length === 0) return "No open tasks.";
    return JSON.stringify(data);
  },
});

const completeTaskTool = betaZodTool({
  name: "complete_task",
  description: "Mark a task complete, given its id (from list_open_tasks).",
  inputSchema: z.object({
    taskId: z.string(),
  }),
  run: async ({ taskId }) => {
    const { error } = await supabase
      .from("tasks")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", taskId);
    if (error) return `Failed to complete task: ${error.message}`;
    return `Marked task ${taskId} complete.`;
  },
});

export function buildInternalTools() {
  return [
    addCustomerTool,
    findCustomerTool,
    buildDocumentTool("estimate"),
    buildDocumentTool("invoice"),
    buildDocumentTool("proposal"),
    addTaskTool,
    listOpenTasksTool,
    completeTaskTool,
  ];
}
