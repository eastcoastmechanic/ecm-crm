/**
 * Pushes CRM records into a Microsoft Graph external connection so Microsoft
 * 365 Copilot can search and answer questions from live CRM data (customers,
 * jobs, documents) rather than only files that happen to sit in
 * OneDrive/SharePoint.
 *
 * Auth is client-credentials (app-only) against the Azure AD app registered
 * for this connector — no user ever signs in. Requires
 * ExternalConnection.ReadWrite.OwnedBy and ExternalItem.ReadWrite.OwnedBy
 * application permissions, admin-consented once in the Entra admin center.
 *
 * Auth uses a certificate-signed JWT assertion rather than a client secret:
 * East Coast Mechanical's tenant has a policy blocking client-secret
 * creation entirely ("Client secrets are blocked by a tenant-wide policy"),
 * which certificate credentials aren't subject to.
 *
 * Every sync function swallows its own errors: a Copilot indexing hiccup
 * must never break the CRM action (creating a customer, closing a job) that
 * triggered it.
 */
import { supabase } from "@/lib/supabase";
import { graphConfigured, graphFetchWithRetry } from "@/lib/graph-auth";

const SITE_ORIGIN = "https://eastcoastmechanical.org";
export const CONNECTION_ID = process.env.MS_GRAPH_CONNECTION_ID || "ecmcrm";

export type CrmItemType = "customer" | "job" | "document" | "price_book_item" | "lead" | "inventory_item";

type CrmExternalItem = {
  type: CrmItemType;
  id: string;
  title: string;
  content: string;
  url: string;
  properties: Record<string, string | number | null>;
};

// "everyone" is Graph's literal ACL value for a connection scoped to the
// whole tenant — this is a one-person company, so there's no narrower group
// worth modeling.
async function pushCrmItem(item: CrmExternalItem): Promise<boolean> {
  if (!graphConfigured()) return true;
  const itemId = `${item.type}-${item.id}`;
  const res = await graphFetchWithRetry(`/external/connections/${CONNECTION_ID}/items/${itemId}`, {
    method: "PUT",
    body: JSON.stringify({
      acl: [{ type: "everyone", value: "everyone", accessType: "grant" }],
      properties: { itemType: item.type, title: item.title, url: item.url, ...item.properties },
      content: { value: item.content, type: "text" },
    }),
  });
  if (!res.ok) {
    console.error(`[graph-connector] push failed for ${itemId}: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

async function deleteCrmItem(type: CrmItemType, id: string): Promise<boolean> {
  if (!graphConfigured()) return true;
  const itemId = `${type}-${id}`;
  const res = await graphFetchWithRetry(`/external/connections/${CONNECTION_ID}/items/${itemId}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    console.error(`[graph-connector] delete failed for ${itemId}: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

export async function syncCustomerToGraph(customerId: string): Promise<boolean> {
  try {
    const { data: customer } = await supabase
      .from("customers")
      .select("id,name,email,phone,billing_address,notes")
      .eq("id", customerId)
      .single();
    if (!customer) return true;

    return await pushCrmItem({
      type: "customer",
      id: customer.id,
      title: customer.name ?? "Customer",
      content: [customer.name, customer.email, customer.phone, customer.billing_address, customer.notes]
        .filter(Boolean)
        .join("\n"),
      url: `${SITE_ORIGIN}/customers/${customer.id}`,
      properties: {
        customerName: customer.name ?? "",
        phone: customer.phone ?? "",
        email: customer.email ?? "",
        address: customer.billing_address ?? "",
      },
    });
  } catch (err) {
    console.error(`[graph-connector] customer sync failed for ${customerId}:`, err);
    return false;
  }
}

export async function deleteCustomerFromGraph(customerId: string): Promise<boolean> {
  return deleteCrmItem("customer", customerId).catch((err) => {
    console.error(`[graph-connector] customer delete failed for ${customerId}:`, err);
    return false;
  });
}

export async function syncJobToGraph(jobId: string): Promise<boolean> {
  try {
    const { data: job } = await supabase
      .from("jobs")
      .select("id,status,scheduled_at,notes,customers(name),properties(address)")
      .eq("id", jobId)
      .single();
    if (!job) return true;

    const customer = job.customers as unknown as { name: string | null } | null;
    const property = job.properties as unknown as { address: string | null } | null;
    const title = [customer?.name, property?.address].filter(Boolean).join(" — ") || "Job";

    return await pushCrmItem({
      type: "job",
      id: job.id,
      title,
      content: [title, `Status: ${job.status}`, job.notes].filter(Boolean).join("\n"),
      url: `${SITE_ORIGIN}/jobs`,
      properties: {
        status: job.status ?? "",
        customerName: customer?.name ?? "",
        address: property?.address ?? "",
        scheduledAt: job.scheduled_at ?? null,
      },
    });
  } catch (err) {
    console.error(`[graph-connector] job sync failed for ${jobId}:`, err);
    return false;
  }
}

export async function deleteJobFromGraph(jobId: string): Promise<boolean> {
  return deleteCrmItem("job", jobId).catch((err) => {
    console.error(`[graph-connector] job delete failed for ${jobId}:`, err);
    return false;
  });
}

export async function syncDocumentToGraph(documentId: string): Promise<boolean> {
  try {
    const { data: doc } = await supabase
      .from("documents")
      .select("id,doc_number,type,status,total,customers(name),properties(address)")
      .eq("id", documentId)
      .single();
    if (!doc) return true;

    const customer = doc.customers as unknown as { name: string | null } | null;
    const property = doc.properties as unknown as { address: string | null } | null;
    const title = `${doc.doc_number ?? doc.type} — ${customer?.name ?? "Unknown customer"}`;

    return await pushCrmItem({
      type: "document",
      id: doc.id,
      title,
      content: [title, property?.address, doc.status ? `Status: ${doc.status}` : null]
        .filter(Boolean)
        .join("\n"),
      url: `${SITE_ORIGIN}/documents/${doc.id}`,
      properties: {
        docType: doc.type ?? "",
        status: doc.status ?? "",
        customerName: customer?.name ?? "",
        address: property?.address ?? "",
        total: doc.total ?? null,
      },
    });
  } catch (err) {
    console.error(`[graph-connector] document sync failed for ${documentId}:`, err);
    return false;
  }
}

export async function deleteDocumentFromGraph(documentId: string): Promise<boolean> {
  return deleteCrmItem("document", documentId).catch((err) => {
    console.error(`[graph-connector] document delete failed for ${documentId}:`, err);
    return false;
  });
}

// unit_cost is deliberately excluded from both content and properties --
// it's margin data that's gated to the owner role even inside the app
// (see app/(internal)/price-book/actions.ts), and indexing it here would
// hand every Copilot user in the tenant a shortcut past that gate.
export async function syncPriceBookItemToGraph(itemId: string): Promise<boolean> {
  try {
    const { data: item } = await supabase
      .from("price_book_items")
      .select("id,category,tier,name,description,unit_price,labor_hours")
      .eq("id", itemId)
      .single();
    if (!item) return true;

    return await pushCrmItem({
      type: "price_book_item",
      id: item.id,
      title: item.name ?? "Price book item",
      content: [item.name, item.category, item.tier, item.description]
        .filter(Boolean)
        .join("\n"),
      url: `${SITE_ORIGIN}/price-book`,
      properties: {
        category: item.category ?? "",
        tier: item.tier ?? "",
        unitPrice: item.unit_price ?? null,
        laborHours: item.labor_hours ?? null,
      },
    });
  } catch (err) {
    console.error(`[graph-connector] price book item sync failed for ${itemId}:`, err);
    return false;
  }
}

export async function deletePriceBookItemFromGraph(itemId: string): Promise<boolean> {
  return deleteCrmItem("price_book_item", itemId).catch((err) => {
    console.error(`[graph-connector] price book item delete failed for ${itemId}:`, err);
    return false;
  });
}

export async function syncLeadToGraph(leadId: string): Promise<boolean> {
  try {
    const { data: lead } = await supabase
      .from("leads")
      .select("id,status,source,channel,contact_name,phone_number,contact_info,address,summary,customers(name)")
      .eq("id", leadId)
      .single();
    if (!lead) return true;

    const customer = lead.customers as unknown as { name: string | null } | null;
    const contactName = lead.contact_name ?? customer?.name ?? "Lead";
    const title = `${contactName} — ${lead.status}`;

    return await pushCrmItem({
      type: "lead",
      id: lead.id,
      title,
      content: [contactName, lead.summary, lead.address, lead.contact_info].filter(Boolean).join("\n"),
      url: `${SITE_ORIGIN}/leads`,
      properties: {
        status: lead.status ?? "",
        source: lead.source ?? "",
        channel: lead.channel ?? "",
        contactName,
        phone: lead.phone_number ?? "",
        address: lead.address ?? "",
      },
    });
  } catch (err) {
    console.error(`[graph-connector] lead sync failed for ${leadId}:`, err);
    return false;
  }
}

export async function deleteLeadFromGraph(leadId: string): Promise<boolean> {
  return deleteCrmItem("lead", leadId).catch((err) => {
    console.error(`[graph-connector] lead delete failed for ${leadId}:`, err);
    return false;
  });
}

export async function syncInventoryItemToGraph(inventoryItemId: string): Promise<boolean> {
  try {
    const { data: item } = await supabase
      .from("inventory_items")
      .select("id,qty_on_hand,reorder_threshold,price_book_items(name,category)")
      .eq("id", inventoryItemId)
      .single();
    if (!item) return true;

    const priceBookItem = item.price_book_items as unknown as { name: string | null; category: string | null } | null;
    const title = priceBookItem?.name ?? "Inventory item";
    const lowStock = item.reorder_threshold !== null && item.qty_on_hand <= item.reorder_threshold;

    return await pushCrmItem({
      type: "inventory_item",
      id: item.id,
      title,
      content: [
        title,
        `On hand: ${item.qty_on_hand}`,
        lowStock ? "LOW STOCK — at or below reorder threshold" : null,
      ]
        .filter(Boolean)
        .join("\n"),
      url: `${SITE_ORIGIN}/inventory`,
      properties: {
        category: priceBookItem?.category ?? "",
        qtyOnHand: item.qty_on_hand,
        reorderThreshold: item.reorder_threshold,
        lowStock: lowStock ? "true" : "false",
      },
    });
  } catch (err) {
    console.error(`[graph-connector] inventory item sync failed for ${inventoryItemId}:`, err);
    return false;
  }
}

export async function deleteInventoryItemFromGraph(inventoryItemId: string): Promise<boolean> {
  return deleteCrmItem("inventory_item", inventoryItemId).catch((err) => {
    console.error(`[graph-connector] inventory item delete failed for ${inventoryItemId}:`, err);
    return false;
  });
}
