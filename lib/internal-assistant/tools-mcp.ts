import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { supabase } from "@/lib/supabase";
import { buildInternalTools } from "./tools";
import { createPendingAction, confirmPendingAction, type ActionExecutor } from "@/lib/pending-actions";
import { idsWhere, idsWhereIn, unique } from "@/lib/cascade-delete";
import { deleteCustomer } from "@/app/(internal)/customers/actions";
import { deleteProperty } from "@/app/(internal)/properties/actions";
import { deleteEquipment } from "@/app/(internal)/equipment/actions";
import { deleteDocument } from "@/app/(internal)/documents/actions";
import { deleteLead } from "@/app/(internal)/leads/actions";
import { deletePriceBookItem } from "@/app/(internal)/price-book/actions";
import { deletePurchaseOrder } from "@/app/(internal)/procurement/actions";
import { sendDocumentEmail } from "@/app/(internal)/documents/[id]/actions";
import { chargeCustomerCard } from "@/lib/customer-charges";

/**
 * buildInternalTools() returns a union of ~40 differently-typed tools --
 * fine for Claude's tool-use, but calling .run()/.parse() on a value typed
 * as "one of these 40 possible shapes" collapses its parameter type to
 * `never` (TypeScript can't know which shape survives a runtime .find()).
 * Same issue, same fix as lib/copilot-actions.ts's CopilotActionTool.
 */
export type McpTool = {
  name: string;
  description?: string;
  parse: (raw: unknown) => unknown;
  run: (input: unknown) => Promise<unknown>;
};

/**
 * MCP-only tools -- deletions, sending, and card charges, gated behind a
 * real propose/confirm cycle instead of the internal chat assistant's
 * prompt-only "confirm with the user before calling" (which has no
 * structural enforcement -- see lib/internal-assistant/agent.ts). A
 * propose_* tool never mutates anything itself; it only builds a preview
 * and writes a row to pending_actions. confirm_action is the only thing
 * that ever calls the real delete/send/charge functions, and only for a
 * token that hasn't been used or expired.
 */

// -------------------------------------------------------------- previews

async function countCascade(table: string, column: string, id: string): Promise<number> {
  return (await idsWhere(table, column, id)).length;
}

async function customerCascadePreview(customerId: string): Promise<{ name: string; preview: string } | null> {
  const { data: customer } = await supabase.from("customers").select("name").eq("id", customerId).single();
  if (!customer) return null;

  const propertyIds = await idsWhere("properties", "customer_id", customerId);
  const jobIds = unique([
    ...(await idsWhere("jobs", "customer_id", customerId)),
    ...(await idsWhereIn("jobs", "property_id", propertyIds)),
  ]);
  const equipmentIds = await idsWhereIn("equipment", "property_id", propertyIds);
  const documentIds = unique([
    ...(await idsWhere("documents", "customer_id", customerId)),
    ...(await idsWhereIn("documents", "property_id", propertyIds)),
  ]);
  const { count: contractCount } = await supabase
    .from("service_contracts")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);

  const parts = [
    `${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}`,
    `${jobIds.length} job${jobIds.length === 1 ? "" : "s"}`,
    `${equipmentIds.length} piece${equipmentIds.length === 1 ? "" : "s"} of equipment`,
    `${documentIds.length} document${documentIds.length === 1 ? "" : "s"}`,
    `${contractCount ?? 0} service contract${contractCount === 1 ? "" : "s"}`,
  ];

  return {
    name: customer.name,
    preview: `This will permanently delete customer ${customer.name} — cascading to ${parts.join(", ")}. This cannot be undone.`,
  };
}

async function propertyCascadePreview(propertyId: string): Promise<{ address: string; preview: string } | null> {
  const { data: property } = await supabase.from("properties").select("address").eq("id", propertyId).single();
  if (!property) return null;

  const [jobCount, equipmentCount, documentCount] = await Promise.all([
    countCascade("jobs", "property_id", propertyId),
    countCascade("equipment", "property_id", propertyId),
    countCascade("documents", "property_id", propertyId),
  ]);
  const { count: contractCount } = await supabase
    .from("service_contracts")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);

  return {
    address: property.address,
    preview: `This will permanently delete property ${property.address} — cascading to ${jobCount} job${jobCount === 1 ? "" : "s"}, ${equipmentCount} piece${equipmentCount === 1 ? "" : "s"} of equipment, ${documentCount} document${documentCount === 1 ? "" : "s"}, ${contractCount ?? 0} service contract${contractCount === 1 ? "" : "s"}. This cannot be undone.`,
  };
}

// -------------------------------------------------------------- propose_* tools

const proposeDeleteCustomerTool = betaZodTool({
  name: "propose_delete_customer",
  description: "Preview permanently deleting a customer and everything under them. Returns a confirmation token — call confirm_action with it to actually delete.",
  inputSchema: z.object({ customerId: z.string() }),
  run: async ({ customerId }) => {
    const result = await customerCascadePreview(customerId);
    if (!result) return `Customer ${customerId} not found.`;
    const { token, expiresInMinutes } = await createPendingAction("delete_customer", { customerId }, result.preview);
    return `${result.preview} Call confirm_action with token "${token}" to proceed. Expires in ${expiresInMinutes} minutes.`;
  },
});

const proposeDeletePropertyTool = betaZodTool({
  name: "propose_delete_property",
  description: "Preview permanently deleting a property and everything under it. Returns a confirmation token — call confirm_action with it to actually delete.",
  inputSchema: z.object({ propertyId: z.string() }),
  run: async ({ propertyId }) => {
    const result = await propertyCascadePreview(propertyId);
    if (!result) return `Property ${propertyId} not found.`;
    const { token, expiresInMinutes } = await createPendingAction("delete_property", { propertyId }, result.preview);
    return `${result.preview} Call confirm_action with token "${token}" to proceed. Expires in ${expiresInMinutes} minutes.`;
  },
});

const proposeDeleteEquipmentTool = betaZodTool({
  name: "propose_delete_equipment",
  description: "Preview permanently deleting a piece of equipment (and its diagnostic history). Returns a confirmation token — call confirm_action with it to actually delete.",
  inputSchema: z.object({ equipmentId: z.string() }),
  run: async ({ equipmentId }) => {
    const { data: equipment } = await supabase
      .from("equipment")
      .select("type, brand, model")
      .eq("id", equipmentId)
      .single();
    if (!equipment) return `Equipment ${equipmentId} not found.`;
    const label = [equipment.brand, equipment.model, equipment.type].filter(Boolean).join(" ") || equipmentId;
    const diagnosticCount = await countCascade("diagnostics", "equipment_id", equipmentId);
    const preview = `This will permanently delete equipment "${label}" — including ${diagnosticCount} diagnostic reading${diagnosticCount === 1 ? "" : "s"} tied to it. This cannot be undone.`;
    const { token, expiresInMinutes } = await createPendingAction("delete_equipment", { equipmentId }, preview);
    return `${preview} Call confirm_action with token "${token}" to proceed. Expires in ${expiresInMinutes} minutes.`;
  },
});

async function simpleDeletePreview(
  actionName: string,
  table: string,
  label: string,
  idField: string,
  id: string,
  select: string,
  describe: (row: Record<string, unknown>) => string
) {
  const { data: row } = await supabase.from(table).select(select).eq("id", id).single();
  if (!row) return `${label} ${id} not found.`;
  const preview = `This will permanently delete ${describe(row as unknown as Record<string, unknown>)}. This cannot be undone.`;
  const { token, expiresInMinutes } = await createPendingAction(actionName, { [idField]: id }, preview);
  return `${preview} Call confirm_action with token "${token}" to proceed. Expires in ${expiresInMinutes} minutes.`;
}

const proposeDeleteDocumentTool = betaZodTool({
  name: "propose_delete_document",
  description: "Preview permanently deleting a document (estimate, invoice, proposal, etc). Returns a confirmation token — call confirm_action with it to actually delete.",
  inputSchema: z.object({ documentId: z.string() }),
  run: async ({ documentId }) =>
    simpleDeletePreview("delete_document", "documents", "Document", "documentId", documentId, "doc_number, type", (r) => `document ${r.doc_number ?? documentId} (${r.type})`),
});

const proposeDeleteLeadTool = betaZodTool({
  name: "propose_delete_lead",
  description: "Preview permanently deleting a lead. Returns a confirmation token — call confirm_action with it to actually delete.",
  inputSchema: z.object({ leadId: z.string() }),
  run: async ({ leadId }) =>
    simpleDeletePreview("delete_lead", "leads", "Lead", "leadId", leadId, "contact_name", (r) => `lead ${r.contact_name ?? leadId}`),
});

const proposeDeletePriceBookItemTool = betaZodTool({
  name: "propose_delete_price_book_item",
  description: "Preview permanently deleting a price book item. Returns a confirmation token — call confirm_action with it to actually delete.",
  inputSchema: z.object({ itemId: z.string() }),
  run: async ({ itemId }) =>
    simpleDeletePreview("delete_price_book_item", "price_book_items", "Price book item", "itemId", itemId, "name", (r) => `price book item "${r.name ?? itemId}"`),
});

const proposeDeletePurchaseOrderTool = betaZodTool({
  name: "propose_delete_purchase_order",
  description: "Preview permanently deleting a purchase order. Returns a confirmation token — call confirm_action with it to actually delete.",
  inputSchema: z.object({ purchaseOrderId: z.string() }),
  run: async ({ purchaseOrderId }) =>
    simpleDeletePreview("delete_purchase_order", "purchase_orders", "Purchase order", "purchaseOrderId", purchaseOrderId, "vendor, po_number", (r) => `purchase order ${r.po_number ?? purchaseOrderId} (${r.vendor})`),
});

const proposeSendDocumentTool = betaZodTool({
  name: "propose_send_document",
  description: "Preview emailing a document to its customer. Returns a confirmation token — call confirm_action with it to actually send. Fails immediately (no token) if there's no email on file.",
  inputSchema: z.object({ documentId: z.string() }),
  run: async ({ documentId }) => {
    const { data: doc } = await supabase
      .from("documents")
      .select("doc_number, type, total, customers(name, email)")
      .eq("id", documentId)
      .single();
    if (!doc) return `Document ${documentId} not found.`;
    const customer = doc.customers as unknown as { name: string | null; email: string | null } | null;
    if (!customer?.email) return `${customer?.name ?? "This customer"} has no email on file — can't send.`;

    const amount = doc.total ? ` ($${Number(doc.total).toFixed(2)})` : "";
    const preview = `This will email ${doc.type} ${doc.doc_number ?? documentId}${amount} to ${customer.email}. It will be marked "sent" immediately.`;
    const { token, expiresInMinutes } = await createPendingAction("send_document", { documentId }, preview);
    return `${preview} Call confirm_action with token "${token}" to proceed. Expires in ${expiresInMinutes} minutes.`;
  },
});

const proposeChargeCustomerTool = betaZodTool({
  name: "propose_charge_customer",
  description:
    "Preview charging a customer's saved card. Returns a confirmation token — call confirm_action with it to actually charge. Fails immediately (no token) if there's no saved card. Requires a reason.",
  inputSchema: z.object({
    customerId: z.string(),
    amountDollars: z.number().positive(),
    reason: z.string().min(1).describe("What this charge is for — shown to Josh before he confirms"),
  }),
  run: async ({ customerId, amountDollars, reason }) => {
    const { data: customer } = await supabase
      .from("customers")
      .select("name, stripe_customer_id")
      .eq("id", customerId)
      .single();
    if (!customer) return `Customer ${customerId} not found.`;
    if (!customer.stripe_customer_id) return `${customer.name} has no Stripe customer record on file — nothing to charge.`;

    const { stripe } = await import("@/lib/stripe");
    const paymentMethods = await stripe.paymentMethods.list({ customer: customer.stripe_customer_id, type: "card" });
    const card = paymentMethods.data[0]?.card;
    if (!card) return `${customer.name} has no saved card on file. Use create_payment_link instead.`;

    const preview = `This will immediately charge $${amountDollars.toFixed(2)} to ${customer.name}'s card on file (${card.brand} ending ${card.last4}), for: ${reason}. This charges the card right now — it is NOT a link the customer approves. Refunds are not supported by this tool; you'd need to refund manually in the Stripe dashboard. This cannot be undone here.`;
    const { token, expiresInMinutes } = await createPendingAction(
      "charge_customer",
      { customerId, amountDollars, reason },
      preview
    );
    return `${preview} Call confirm_action with token "${token}" to proceed. Expires in ${expiresInMinutes} minutes.`;
  },
});

// -------------------------------------------------------------- confirm

const executors: Record<string, ActionExecutor> = {
  delete_customer: async (input) => {
    const { customerId } = input as { customerId: string };
    const result = await deleteCustomer(customerId);
    if (result.error) throw new Error(result.error);
    return `Deleted customer ${customerId}.`;
  },
  delete_property: async (input) => {
    const { propertyId } = input as { propertyId: string };
    const result = await deleteProperty(propertyId);
    if (result.error) throw new Error(result.error);
    return `Deleted property ${propertyId}.`;
  },
  delete_equipment: async (input) => {
    const { equipmentId } = input as { equipmentId: string };
    const result = await deleteEquipment(equipmentId);
    if (result.error) throw new Error(result.error);
    return `Deleted equipment ${equipmentId}.`;
  },
  delete_document: async (input) => {
    const { documentId } = input as { documentId: string };
    const result = await deleteDocument(documentId);
    if (result.error) throw new Error(result.error);
    return `Deleted document ${documentId}.`;
  },
  delete_lead: async (input) => {
    const { leadId } = input as { leadId: string };
    const result = await deleteLead(leadId);
    if (result.error) throw new Error(result.error);
    return `Deleted lead ${leadId}.`;
  },
  delete_price_book_item: async (input) => {
    const { itemId } = input as { itemId: string };
    const result = await deletePriceBookItem(itemId);
    if (result.error) throw new Error(result.error);
    return `Deleted price book item ${itemId}.`;
  },
  delete_purchase_order: async (input) => {
    const { purchaseOrderId } = input as { purchaseOrderId: string };
    const result = await deletePurchaseOrder(purchaseOrderId);
    if (result.error) throw new Error(result.error);
    return `Deleted purchase order ${purchaseOrderId}.`;
  },
  send_document: async (input) => {
    const { documentId } = input as { documentId: string };
    const fd = new FormData();
    fd.set("id", documentId);
    await sendDocumentEmail(fd);
    return `Sent document ${documentId}.`;
  },
  charge_customer: async (input) => {
    const { customerId, amountDollars, reason } = input as { customerId: string; amountDollars: number; reason: string };
    return chargeCustomerCard(customerId, amountDollars, reason);
  },
};

const confirmActionTool = betaZodTool({
  name: "confirm_action",
  description: "Execute a previously proposed action (delete, send, or charge), given the confirmation token a propose_* tool returned.",
  inputSchema: z.object({
    token: z.string().describe("The confirmation token returned by a propose_* tool"),
  }),
  run: async ({ token }) => confirmPendingAction(token, executors),
});

const GATED_TOOL_NAMES = new Set([
  "delete_customer",
  "delete_property",
  "delete_equipment",
  "delete_document",
  "delete_lead",
  "delete_price_book_item",
  "delete_purchase_order",
  "send_document",
]);

export function buildMcpTools(): McpTool[] {
  const base = (buildInternalTools({ fast: true }) as unknown as McpTool[]).filter(
    (tool) => !GATED_TOOL_NAMES.has(tool.name)
  );
  const gated = [
    proposeDeleteCustomerTool,
    proposeDeletePropertyTool,
    proposeDeleteEquipmentTool,
    proposeDeleteDocumentTool,
    proposeDeleteLeadTool,
    proposeDeletePriceBookItemTool,
    proposeDeletePurchaseOrderTool,
    proposeSendDocumentTool,
    proposeChargeCustomerTool,
    confirmActionTool,
  ] as unknown as McpTool[];
  return [...base, ...gated];
}
