import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { supabase } from "@/lib/supabase";
import { generateDocumentForCustomer, startDocumentGenerationInBackground } from "@/lib/document-generation";
import { createWarrantyForCustomer, type WarrantyEquipmentInput } from "@/lib/warranty-creation";
import { createMassSaveRebateForCustomer } from "@/lib/mass-save-rebate-creation";
import { updateCustomer, deleteCustomer } from "@/app/(internal)/customers/actions";
import { addProperty, updateProperty, deleteProperty } from "@/app/(internal)/properties/actions";
import { addEquipment, updateEquipment, deleteEquipment } from "@/app/(internal)/equipment/actions";
import { updateWarranty } from "@/app/(internal)/documents/[id]/actions";
import { deleteDocument } from "@/app/(internal)/documents/actions";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

// Deliberately separate from buildDocumentTool: a quick sell-price lookup
// against the real price book, with no document created and no ~70s Claude
// pricing call -- "how much is X" shouldn't require generating a whole
// estimate. Sell price only, no unit_cost -- the chat pipeline has no staff
// role plumbed through it to gate that the way the rest of the app does.
const searchPriceBookTool = betaZodTool({
  name: "search_price_book",
  description:
    "Look up real sell prices from the price book for a quick question like 'how much is a Daikin mini-split' or 'what do we charge for a water heater'. Returns matching line items with their good/better/best (or flat) pricing. Use this instead of create_estimate/invoice/proposal when the tech just wants a price, not a document.",
  inputSchema: z.object({
    query: z.string().describe("Search term — an item name, category, or brand (e.g. 'mini-split', 'Daikin', 'water heater')"),
  }),
  run: async ({ query }) => {
    const { data, error } = await supabase
      .from("price_book_items")
      .select("category, name, tier, unit_price")
      .or(`name.ilike.%${query}%,category.ilike.%${query}%`)
      .order("category", { ascending: true })
      .order("name", { ascending: true })
      .limit(20);
    if (error) return `Price book search failed: ${error.message}`;
    if (!data || data.length === 0) return `No price book items match "${query}".`;

    const grouped = new Map<string, { tier: string | null; unit_price: number | null }[]>();
    for (const row of data) {
      if (!grouped.has(row.name)) grouped.set(row.name, []);
      grouped.get(row.name)!.push({ tier: row.tier, unit_price: row.unit_price });
    }

    const lines = [...grouped.entries()].map(([name, rows]) => {
      const priced = rows
        .map((r) => (r.unit_price === null ? null : r.tier ? `${r.tier}=${formatMoney(r.unit_price)}` : formatMoney(r.unit_price)))
        .filter(Boolean);
      return `${name}: ${priced.join(", ")}`;
    });
    return lines.join("\n");
  },
});

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

const updateCustomerTool = betaZodTool({
  name: "update_customer",
  description: "Edit an existing customer's name, phone, email, billing address, or notes. Use find_customer to get the id first. Only pass fields that should change — omitted fields keep their current value.",
  inputSchema: z.object({
    customerId: z.string(),
    name: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    billingAddress: z.string().optional(),
    notes: z.string().optional(),
  }),
  run: async ({ customerId, name, phone, email, billingAddress, notes }) => {
    const { data: existing, error: fetchError } = await supabase
      .from("customers")
      .select("name, phone, email, billing_address, notes, sms_consent")
      .eq("id", customerId)
      .single();
    if (fetchError || !existing) return `Customer not found: ${fetchError?.message ?? customerId}`;

    const fd = new FormData();
    fd.set("id", customerId);
    fd.set("name", name ?? existing.name ?? "");
    fd.set("email", email ?? existing.email ?? "");
    fd.set("phone", phone ?? existing.phone ?? "");
    fd.set("billing_address", billingAddress ?? existing.billing_address ?? "");
    fd.set("notes", notes ?? existing.notes ?? "");
    if (existing.sms_consent) fd.set("sms_consent", "on");

    try {
      await updateCustomer(fd);
      return `Updated customer ${customerId}.`;
    } catch (err) {
      return `Failed to update customer: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

const deleteCustomerTool = betaZodTool({
  name: "delete_customer",
  description: "Permanently delete a customer and everything under them — properties, equipment, jobs, documents, diagnostics, and service history. This cannot be undone; confirm with the user before calling.",
  inputSchema: z.object({
    customerId: z.string(),
  }),
  run: async ({ customerId }) => {
    const result = await deleteCustomer(customerId);
    if (result.error) return result.error;
    return `Deleted customer ${customerId}.`;
  },
});

const listPropertiesTool = betaZodTool({
  name: "list_properties",
  description: "List a customer's properties (id, address, type) so you can reference or update one. Use find_customer first to get the customerId.",
  inputSchema: z.object({
    customerId: z.string(),
  }),
  run: async ({ customerId }) => {
    const { data, error } = await supabase
      .from("properties")
      .select("id, address, property_type")
      .eq("customer_id", customerId);
    if (error) return `Failed to list properties: ${error.message}`;
    if (!data || data.length === 0) return "This customer has no properties on file.";
    return JSON.stringify(data);
  },
});

const addPropertyTool = betaZodTool({
  name: "add_property",
  description: "Add a new property/service address for an existing customer. Use find_customer first to get the customerId.",
  inputSchema: z.object({
    customerId: z.string(),
    address: z.string(),
    propertyType: z.enum(["residential", "commercial"]).optional(),
  }),
  run: async ({ customerId, address, propertyType }) => {
    const fd = new FormData();
    fd.set("customer_id", customerId);
    fd.set("address", address);
    if (propertyType) fd.set("property_type", propertyType);
    try {
      await addProperty(fd);
      return `Added property "${address}".`;
    } catch (err) {
      return `Failed to add property: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

const updatePropertyTool = betaZodTool({
  name: "update_property",
  description: "Edit an existing property's address or type. Use list_properties to get the propertyId first. Only pass fields that should change.",
  inputSchema: z.object({
    propertyId: z.string(),
    address: z.string().optional(),
    propertyType: z.enum(["residential", "commercial"]).optional(),
  }),
  run: async ({ propertyId, address, propertyType }) => {
    const { data: existing, error: fetchError } = await supabase
      .from("properties")
      .select("address, property_type, customer_id")
      .eq("id", propertyId)
      .single();
    if (fetchError || !existing) return `Property not found: ${fetchError?.message ?? propertyId}`;

    const fd = new FormData();
    fd.set("id", propertyId);
    fd.set("customer_id", existing.customer_id ?? "");
    fd.set("address", address ?? existing.address);
    fd.set("property_type", propertyType ?? existing.property_type ?? "");

    try {
      await updateProperty(fd);
      return `Updated property ${propertyId}.`;
    } catch (err) {
      return `Failed to update property: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

const deletePropertyTool = betaZodTool({
  name: "delete_property",
  description: "Permanently delete a property and everything under it — equipment, jobs, documents, and service contracts. This cannot be undone; confirm with the user before calling.",
  inputSchema: z.object({
    propertyId: z.string(),
  }),
  run: async ({ propertyId }) => {
    const result = await deleteProperty(propertyId);
    if (result.error) return result.error;
    return `Deleted property ${propertyId}.`;
  },
});

const listEquipmentTool = betaZodTool({
  name: "list_equipment",
  description: "List equipment (id, type, brand, model, serial number) for a given property. Use list_properties first to get the propertyId.",
  inputSchema: z.object({
    propertyId: z.string(),
  }),
  run: async ({ propertyId }) => {
    const { data, error } = await supabase
      .from("equipment")
      .select("id, type, brand, model, serial_number, install_date, warranty_expiration")
      .eq("property_id", propertyId);
    if (error) return `Failed to list equipment: ${error.message}`;
    if (!data || data.length === 0) return "This property has no equipment on file.";
    return JSON.stringify(data);
  },
});

const addEquipmentTool = betaZodTool({
  name: "add_equipment",
  description: "Add a new piece of equipment to a property. Use list_properties first to get the propertyId.",
  inputSchema: z.object({
    propertyId: z.string(),
    type: z.string().describe("e.g. mini-split, boiler, tankless water heater"),
    brand: z.string().optional(),
    model: z.string().optional(),
    serialNumber: z.string().optional(),
    refrigerantType: z.string().optional(),
    installDate: z.string().optional().describe("YYYY-MM-DD"),
    warrantyExpiration: z.string().optional().describe("YYYY-MM-DD"),
    barcode: z.string().optional().describe("Code printed under the barcode on the rating plate, no asterisks"),
    nameplate: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        "Remaining rating-plate data: manufacture_date, voltage, phase, refrigerant_charge, btu_input, btu_output, seer, ahri_number"
      ),
  }),
  run: async ({ propertyId, type, brand, model, serialNumber, refrigerantType, installDate, warrantyExpiration, barcode, nameplate }) => {
    const fd = new FormData();
    fd.set("property_id", propertyId);
    fd.set("type", type);
    if (brand) fd.set("brand", brand);
    if (model) fd.set("model", model);
    if (serialNumber) fd.set("serial_number", serialNumber);
    if (refrigerantType) fd.set("refrigerant_type", refrigerantType);
    if (installDate) fd.set("install_date", installDate);
    if (warrantyExpiration) fd.set("warranty_expiration", warrantyExpiration);
    if (barcode) fd.set("barcode", barcode);
    if (nameplate) fd.set("nameplate", JSON.stringify(nameplate));
    try {
      await addEquipment(fd);
      return `Added equipment "${type}${brand ? ` — ${brand}` : ""}".`;
    } catch (err) {
      return `Failed to add equipment: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

const updateEquipmentTool = betaZodTool({
  name: "update_equipment",
  description: "Edit an existing piece of equipment. Use list_equipment to get the equipmentId first. Only pass fields that should change.",
  inputSchema: z.object({
    equipmentId: z.string(),
    type: z.string().optional(),
    brand: z.string().optional(),
    model: z.string().optional(),
    serialNumber: z.string().optional(),
    refrigerantType: z.string().optional(),
    installDate: z.string().optional().describe("YYYY-MM-DD"),
    warrantyExpiration: z.string().optional().describe("YYYY-MM-DD"),
    barcode: z.string().optional().describe("Code printed under the barcode on the rating plate, no asterisks"),
    nameplate: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        "Remaining rating-plate data: manufacture_date, voltage, phase, refrigerant_charge, btu_input, btu_output, seer, ahri_number"
      ),
  }),
  run: async ({ equipmentId, type, brand, model, serialNumber, refrigerantType, installDate, warrantyExpiration, barcode, nameplate }) => {
    const { data: existing, error: fetchError } = await supabase
      .from("equipment")
      .select("property_id, type, brand, model, serial_number, refrigerant_type, install_date, warranty_expiration, barcode, nameplate")
      .eq("id", equipmentId)
      .single();
    if (fetchError || !existing) return `Equipment not found: ${fetchError?.message ?? equipmentId}`;

    const fd = new FormData();
    fd.set("id", equipmentId);
    fd.set("property_id", existing.property_id ?? "");
    fd.set("type", type ?? existing.type);
    fd.set("brand", brand ?? existing.brand ?? "");
    fd.set("model", model ?? existing.model ?? "");
    fd.set("serial_number", serialNumber ?? existing.serial_number ?? "");
    fd.set("refrigerant_type", refrigerantType ?? existing.refrigerant_type ?? "");
    fd.set("install_date", installDate ?? existing.install_date ?? "");
    fd.set("warranty_expiration", warrantyExpiration ?? existing.warranty_expiration ?? "");
    fd.set("barcode", barcode ?? existing.barcode ?? "");
    // Merge rather than replace: a second photo of the same plate shouldn't
    // wipe fields that were legible the first time round.
    const mergedNameplate = { ...(existing.nameplate ?? {}), ...(nameplate ?? {}) };
    fd.set("nameplate", Object.keys(mergedNameplate).length ? JSON.stringify(mergedNameplate) : "");

    try {
      await updateEquipment(fd);
      return `Updated equipment ${equipmentId}.`;
    } catch (err) {
      return `Failed to update equipment: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

const deleteEquipmentTool = betaZodTool({
  name: "delete_equipment",
  description: "Permanently delete a piece of equipment and its diagnostic history. Any leads pointing at it are unlinked, not deleted. This cannot be undone; confirm with the user before calling.",
  inputSchema: z.object({
    equipmentId: z.string(),
  }),
  run: async ({ equipmentId }) => {
    const result = await deleteEquipment(equipmentId);
    if (result.error) return result.error;
    return `Deleted equipment ${equipmentId}.`;
  },
});

const listDocumentsTool = betaZodTool({
  name: "list_documents",
  description: "List a customer's documents (id, doc number, type, status) — estimates, invoices, proposals, assessments, warranties, Mass Save rebates. Use to find a documentId before updating or deleting one.",
  inputSchema: z.object({
    customerId: z.string(),
    type: z
      .enum(["estimate", "invoice", "proposal", "assessment", "warranty", "mass_save_rebate"])
      .optional(),
  }),
  run: async ({ customerId, type }) => {
    let query = supabase
      .from("documents")
      .select("id, doc_number, type, status, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });
    if (type) query = query.eq("type", type);
    const { data, error } = await query;
    if (error) return `Failed to list documents: ${error.message}`;
    if (!data || data.length === 0) return "No documents found for this customer.";
    return JSON.stringify(data);
  },
});

const deleteDocumentTool = betaZodTool({
  name: "delete_document",
  description: "Permanently delete any document (estimate, invoice, proposal, assessment, warranty, or Mass Save rebate). Use list_documents to get the documentId first.",
  inputSchema: z.object({
    documentId: z.string(),
  }),
  run: async ({ documentId }) => {
    const result = await deleteDocument(documentId);
    if (result.error) return result.error;
    return `Deleted document ${documentId}.`;
  },
});

const updateWarrantyTool = betaZodTool({
  name: "update_warranty",
  description: "Edit an existing warranty document — the installer name, or a specific equipment item's model, serial number, install date, docket number, manufacturer warranty length, or registration status/date. Use list_documents (type: warranty) to get the documentId, and it returns the equipment items with their index.",
  inputSchema: z.object({
    documentId: z.string(),
    technicianName: z.string().optional(),
    itemIndex: z.number().optional().describe("0-based index of the equipment item to change, from list_documents/list_warranty_items"),
    model: z.string().optional(),
    serialNumber: z.string().optional(),
    installDate: z.string().optional().describe("YYYY-MM-DD"),
    docketNumber: z.string().optional(),
    manufacturerYears: z.number().optional(),
    registered: z.boolean().optional(),
    registrationDate: z.string().optional().describe("YYYY-MM-DD"),
  }),
  run: async ({
    documentId,
    technicianName,
    itemIndex,
    model,
    serialNumber,
    installDate,
    docketNumber,
    manufacturerYears,
    registered,
    registrationDate,
  }) => {
    type WarrantyItem = {
      equipment_label: string;
      model: string | null;
      serial_number: string | null;
      install_date: string | null;
      manufacturer: {
        docket_number: string | null;
        years: number | null;
        registered: boolean;
        registration_date: string | null;
      };
    };

    const { data: existing, error: fetchError } = await supabase
      .from("documents")
      .select("line_items")
      .eq("id", documentId)
      .single();
    if (fetchError || !existing) return `Warranty document not found: ${fetchError?.message ?? documentId}`;

    const lineData = existing.line_items as { items?: WarrantyItem[]; technician_name?: string | null } | null;
    const items = lineData?.items ?? [];
    if (itemIndex !== undefined && !items[itemIndex]) {
      return `No equipment item at index ${itemIndex} — this document has ${items.length} item(s) (indices 0-${items.length - 1}).`;
    }

    const fd = new FormData();
    fd.set("id", documentId);
    fd.set("technician_name", technicianName ?? lineData?.technician_name ?? "");
    fd.set("item_count", String(items.length));

    items.forEach((item, i) => {
      const isTarget = i === itemIndex;
      fd.set(`model_${i}`, (isTarget ? model : undefined) ?? item.model ?? "");
      fd.set(`serial_number_${i}`, (isTarget ? serialNumber : undefined) ?? item.serial_number ?? "");
      fd.set(`install_date_${i}`, (isTarget ? installDate : undefined) ?? item.install_date ?? "");
      fd.set(`docket_number_${i}`, (isTarget ? docketNumber : undefined) ?? item.manufacturer.docket_number ?? "");
      const years = isTarget && manufacturerYears !== undefined ? manufacturerYears : item.manufacturer.years;
      if (years !== null && years !== undefined) fd.set(`manufacturer_years_${i}`, String(years));
      const isRegistered = isTarget && registered !== undefined ? registered : item.manufacturer.registered;
      if (isRegistered) fd.set(`registered_${i}`, "on");
      fd.set(
        `registration_date_${i}`,
        (isTarget ? registrationDate : undefined) ?? item.manufacturer.registration_date ?? ""
      );
    });

    try {
      await updateWarranty(fd);
      return `Updated warranty document ${documentId}.`;
    } catch (err) {
      return `Failed to update warranty: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

const createWarrantyTool = betaZodTool({
  name: "create_warranty",
  description: "Create a real warranty registration document for an existing customer/property, covering one or more pieces of equipment. Computes manufacturer + craftsmanship expiration dates automatically. Use find_customer and list_properties first to get the ids; use list_equipment if warrantying existing equipment rather than newly-installed equipment.",
  inputSchema: z.object({
    customerId: z.string(),
    propertyId: z.string(),
    technicianName: z.string().optional().describe("Installer name, defaults to Joshua Crowley if omitted"),
    equipment: z
      .array(
        z.object({
          equipmentId: z.string().optional().describe("Existing equipment id, from list_equipment — omit for newly-installed equipment"),
          newEquipmentType: z.string().optional().describe("Required if equipmentId is omitted, e.g. 'mini-split', 'boiler'"),
          newEquipmentBrand: z.string().optional(),
          model: z.string().optional(),
          serialNumber: z.string().optional(),
          installDate: z.string().optional().describe("YYYY-MM-DD"),
          docketNumber: z.string().optional(),
          manufacturerYears: z.number().optional(),
          registered: z.boolean().optional(),
          registrationDate: z.string().optional().describe("YYYY-MM-DD"),
        })
      )
      .min(1)
      .describe("One entry per piece of equipment this warranty covers"),
  }),
  run: async ({ customerId, propertyId, technicianName, equipment }) => {
    try {
      const result = await createWarrantyForCustomer({
        customerId,
        propertyId,
        technicianName: technicianName ?? "Joshua Crowley",
        equipment: equipment as WarrantyEquipmentInput[],
      });
      return `Created warranty ${result.docNumber}. /documents/${result.documentId}`;
    } catch (err) {
      return `Failed to create warranty: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

const createMassSaveRebateTool = betaZodTool({
  name: "create_mass_save_rebate",
  description: "Create a draft Mass Save Air Source Heat Pump rebate application document for an existing customer/property. Almost every field is optional and defaults to blank, same as the human form — this creates a real draft document under the customer that can be finished/filled in the app, it does not need to be submission-ready from chat alone. Use find_customer and list_properties first to get the ids.",
  inputSchema: z.object({
    customerId: z.string(),
    propertyId: z.string(),
    equipmentIds: z.array(z.string()).optional().describe("Existing equipment ids (from list_equipment) this rebate covers"),
    electricSponsor: z.string().optional(),
    gasSponsor: z.string().optional(),
    occupancy: z.string().optional(),
    housingType: z.string().optional(),
    totalSquareFootage: z.string().optional(),
    preExistingHeating: z.string().optional(),
  }),
  run: async ({ customerId, propertyId, equipmentIds, electricSponsor, gasSponsor, occupancy, housingType, totalSquareFootage, preExistingHeating }) => {
    try {
      const result = await createMassSaveRebateForCustomer({
        customerId,
        propertyId,
        equipment: (equipmentIds ?? []).map((id) => ({ equipmentId: id })),
        sponsor: { electric: electricSponsor ?? null, gas: gasSponsor ?? null },
        project: {
          occupancy: occupancy ?? null,
          housingType: housingType ?? null,
          totalSquareFootage: totalSquareFootage ?? null,
          preExistingHeating: preExistingHeating ?? null,
        },
      });
      return `Created draft Mass Save rebate application. /documents/${result.documentId} — finish filling in exact rebate details in the app before submitting.`;
    } catch (err) {
      return `Failed to create Mass Save rebate: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
});

function buildDocumentTool(type: "estimate" | "invoice" | "proposal", fast?: boolean, attachmentFiles?: File[]) {
  return betaZodTool({
    name: `create_${type}`,
    description: `Generate a real ${type} using the price book and Claude, for an existing or brand-new customer. Creates an actual draft ${type} in the CRM. By default it's priced good/better/best (three tiers); pass pricingMode "flat" if the tech/customer wants one straight price per line instead of a tiered choice.${
      attachmentFiles?.length
        ? " A PDF plan set and/or photos are attached to this conversation and will be passed through automatically to ground pricing/scope -- no need to describe every detail already visible on the plans."
        : ""
    }${
      fast
        ? " Runs in the background and returns immediately without a price -- real price-book pricing takes about a minute, so tell the tech to check the CRM shortly rather than expecting the number in this reply."
        : ""
    }`,
    inputSchema: z.object({
      customerId: z.string().optional().describe("Existing customer id, from find_customer"),
      customerName: z.string().optional().describe("Required only if this is a brand-new customer"),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional().describe("Service address, if known"),
      jobDescription: z.string().describe("What the job involves, in enough detail to select price book items"),
      pricingMode: z
        .enum(["tiered", "flat"])
        .optional()
        .describe("'tiered' (default) shows good/better/best per line; 'flat' shows one price per line, no tiers."),
    }),
    run: async ({ customerId, customerName, phone, email, address, jobDescription, pricingMode }) => {
      if (!customerId && !customerName) {
        return "Need either an existing customerId (use find_customer) or a customerName for a new customer.";
      }
      try {
        if (fast) {
          // Pricing a real good/better/best estimate against the full price
          // book reliably takes 70s+, longer than the Teams/Copilot connector's
          // own timeout -- so this path can't wait on it. Kick generation off
          // in the background and reply immediately; the finished document
          // lands in the CRM a bit later instead of in this same chat turn.
          const { customerName: resolvedName, propertyAddress } = await startDocumentGenerationInBackground({
            customerId,
            customerName,
            phone,
            email,
            address,
            type,
            rawRequest: jobDescription,
            pricingMode,
            fast,
            photos: attachmentFiles,
          });
          return `Generating the ${type} for ${resolvedName}${
            propertyAddress ? ` at ${propertyAddress}` : ""
          } now — real price-book pricing takes about a minute, so check the CRM shortly for the finished draft.`;
        }
        const results = await generateDocumentForCustomer({
          customerId,
          customerName,
          phone,
          email,
          address,
          type,
          rawRequest: jobDescription,
          pricingMode,
          fast,
          photos: attachmentFiles,
        });
        const lines = results.map((r) =>
          r.pricingMode === "flat"
            ? `${r.docNumber}${r.optionLabel ? ` (${r.optionLabel})` : ""} — ${formatMoney(r.totals.better)} flat. /documents/${r.documentId}`
            : `${r.docNumber}${r.optionLabel ? ` (${r.optionLabel})` : ""} — Good ${formatMoney(
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

export function buildInternalTools(options?: { fast?: boolean; attachmentFiles?: File[] }) {
  const fast = options?.fast;
  const attachmentFiles = options?.attachmentFiles;
  return [
    addCustomerTool,
    findCustomerTool,
    updateCustomerTool,
    deleteCustomerTool,
    listPropertiesTool,
    addPropertyTool,
    updatePropertyTool,
    deletePropertyTool,
    listEquipmentTool,
    addEquipmentTool,
    updateEquipmentTool,
    deleteEquipmentTool,
    listDocumentsTool,
    deleteDocumentTool,
    searchPriceBookTool,
    updateWarrantyTool,
    createWarrantyTool,
    createMassSaveRebateTool,
    buildDocumentTool("estimate", fast, attachmentFiles),
    buildDocumentTool("invoice", fast, attachmentFiles),
    buildDocumentTool("proposal", fast, attachmentFiles),
    addTaskTool,
    listOpenTasksTool,
    completeTaskTool,
  ];
}
