import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { findCustomerByPhone } from "@/lib/receptionist/customer-lookup";
import { syncCustomerToGraph, syncDocumentToGraph, syncJobToGraph } from "@/lib/graph-connector";

/**
 * Machine ingest for catalog / field quotes.
 *
 * The ECM catalog app (and any future field tool) posts a fully-priced package
 * here. We upsert customer + property, create a flat-priced estimate document
 * with the exact line items the tech already built, and optionally open a job.
 *
 * Auth is the shared internal Basic-Auth gate in proxy.ts — this path is in
 * INTERNAL_API_PATHS so unauthenticated callers get a plain 401, not an HTML
 * login page.
 */

const DOC_PREFIX: Record<string, string> = {
  estimate: "EST",
  invoice: "INV",
  proposal: "PROP",
};

const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://ecm-crm.vercel.app";

type IncomingLineItem = {
  description: string;
  qty?: number;
  unit?: string;
  unitPrice?: number;
  unit_price?: number;
  category?: string;
  model?: string;
  notes?: string;
  price_book_item_name?: string | null;
};

type Body = {
  source?: string;
  customer?: {
    customerId?: string;
    name?: string;
    email?: string;
    phone?: string;
    smsConsent?: boolean;
  };
  property?: {
    propertyId?: string;
    address?: string;
  };
  job?: {
    createJob?: boolean;
    jobId?: string;
    notes?: string;
    status?: string;
  };
  document?: {
    type?: "estimate" | "invoice" | "proposal";
    status?: "draft" | "sent";
    lineItems?: IncomingLineItem[];
    subtotal?: number;
    tax?: number;
    total?: number;
    laborHours?: number;
    laborRate?: number;
    depositPercent?: number;
    notes?: string;
    rawRequest?: string;
  };
};

function money(n: number) {
  return Math.round(n * 100) / 100;
}

async function nextDocNumber(type: string) {
  const { count } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("type", type);
  const seq = 1001 + (count ?? 0);
  return `${DOC_PREFIX[type] ?? "DOC"}-${seq}`;
}

async function findCustomerByEmail(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const { data } = await supabase
    .from("customers")
    .select("id, email")
    .ilike("email", normalized)
    .limit(5);
  const match = (data ?? []).find((c) => (c.email ?? "").trim().toLowerCase() === normalized);
  return match?.id ?? null;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const customerIn = body.customer ?? {};
  const propertyIn = body.property ?? {};
  const jobIn = body.job ?? {};
  const docIn = body.document ?? {};

  const type = docIn.type ?? "estimate";
  if (!DOC_PREFIX[type]) {
    return NextResponse.json({ error: `Invalid document type "${type}"` }, { status: 400 });
  }

  const status = docIn.status === "sent" ? "sent" : "draft";
  const lineItems = Array.isArray(docIn.lineItems) ? docIn.lineItems : [];

  if (lineItems.length === 0 && !(docIn.laborHours && docIn.laborHours > 0)) {
    return NextResponse.json({ error: "Add at least one line item (or labor hours)" }, { status: 400 });
  }

  // Resolve customer: explicit id → phone match → email match → create.
  let customerId = customerIn.customerId?.trim() || null;
  let customerMatchedBy: string | null = customerId ? "customerId" : null;

  if (!customerId && customerIn.phone) {
    const match = await findCustomerByPhone(customerIn.phone);
    if (match) {
      customerId = match.id;
      customerMatchedBy = "phone";
    }
  }

  if (!customerId && customerIn.email) {
    const byEmail = await findCustomerByEmail(customerIn.email);
    if (byEmail) {
      customerId = byEmail;
      customerMatchedBy = "email";
    }
  }

  if (!customerId && !customerIn.name?.trim()) {
    return NextResponse.json(
      { error: "Customer name is required when no existing customer matches phone/email" },
      { status: 400 }
    );
  }

  let propertyId = propertyIn.propertyId?.trim() || null;

  try {
    const resolved = await resolveCustomerPropertyEquipment({
      customerId,
      customerName: customerIn.name?.trim() || null,
      phone: customerIn.phone?.trim() || null,
      email: customerIn.email?.trim() || null,
      smsConsent: customerIn.smsConsent,
      propertyId,
      address: propertyIn.address?.trim() || null,
    });
    customerId = resolved.customerId;
    propertyId = resolved.propertyId;

    if (!customerId) {
      return NextResponse.json({ error: "Could not resolve customer" }, { status: 500 });
    }

    // If we matched an existing customer, patch missing contact fields.
    if (customerMatchedBy === "phone" || customerMatchedBy === "email" || customerMatchedBy === "customerId") {
      const patch: Record<string, string | null> = {};
      if (customerIn.email?.trim()) patch.email = customerIn.email.trim();
      if (customerIn.phone?.trim()) patch.phone = customerIn.phone.trim();
      if (Object.keys(patch).length > 0) {
        await supabase.from("customers").update(patch).eq("id", customerId);
      }
    }

    await syncCustomerToGraph(customerId);

    // Build flat line items in the CRM document shape.
    const itemsForStorage = lineItems.map((item) => {
      const unitPrice = Number(item.unitPrice ?? item.unit_price ?? 0);
      const qty = Number(item.qty ?? 1);
      const description =
        item.description?.trim() ||
        item.model?.trim() ||
        item.price_book_item_name?.trim() ||
        "Line item";
      return {
        category: item.category?.trim() || "Equipment",
        description,
        price_book_item_name: item.price_book_item_name ?? item.model ?? null,
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        unit: item.unit?.trim() || "EA",
        good: money(unitPrice),
        better: money(unitPrice),
        best: money(unitPrice),
        notes: item.notes ?? null,
        cost: null as number | null,
      };
    });

    if (docIn.laborHours && docIn.laborHours > 0) {
      const rate = Number(docIn.laborRate ?? 125);
      const hours = Number(docIn.laborHours);
      itemsForStorage.push({
        category: "Labor",
        description: `Labor (${hours} hr @ $${rate}/hr)`,
        price_book_item_name: null,
        qty: hours,
        unit: "HR",
        good: money(rate),
        better: money(rate),
        best: money(rate),
        notes: null,
        cost: null,
      });
    }

    const computedSubtotal = money(
      itemsForStorage.reduce((sum, item) => sum + item.better * item.qty, 0)
    );
    const subtotal = docIn.subtotal != null ? money(Number(docIn.subtotal)) : computedSubtotal;
    const tax = docIn.tax != null ? money(Number(docIn.tax)) : 0;
    const total =
      docIn.total != null ? money(Number(docIn.total)) : money(subtotal + tax);

    const depositPercent =
      docIn.depositPercent != null && Number.isFinite(Number(docIn.depositPercent))
        ? Number(docIn.depositPercent)
        : 50;

    // Optional job first so documents.job_id can point at it.
    let jobId = jobIn.jobId?.trim() || null;
    const shouldCreateJob = jobIn.createJob !== false && !jobId;

    if (shouldCreateJob) {
      const jobNotes = [jobIn.notes, docIn.notes, docIn.rawRequest]
        .filter(Boolean)
        .join("\n\n")
        .trim();

      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          customer_id: customerId,
          property_id: propertyId,
          status: jobIn.status || "requested",
          notes: jobNotes || null,
          created_via: body.source === "catalog-app" ? "catalog_app" : "api",
        })
        .select("id")
        .single();

      if (jobError) {
        return NextResponse.json({ error: `Failed to create job: ${jobError.message}` }, { status: 500 });
      }
      jobId = job.id;
      await syncJobToGraph(jobId);
    }

    const docNumber = await nextDocNumber(type);
    const rawRequest =
      docIn.rawRequest?.trim() ||
      docIn.notes?.trim() ||
      `Ingested from ${body.source ?? "api"} with ${itemsForStorage.length} line items`;

    const { data: document, error: docError } = await supabase
      .from("documents")
      .insert({
        doc_number: docNumber,
        type,
        customer_id: customerId,
        property_id: propertyId,
        job_id: jobId,
        status,
        line_items: {
          items: itemsForStorage,
          brand: { good: null, better: null, best: null },
          mass_save_eligible: false,
          mass_save_note: null,
          totals: { good: total, better: total, best: total },
          option_label: null,
          pricing_mode: "flat",
          deposit_percent: depositPercent,
          deposit_amount: money(total * (depositPercent / 100)),
          source: body.source ?? "api",
        },
        subtotal,
        tax,
        total,
        ai_generated: false,
        raw_request: rawRequest,
        photos: [],
        sent_at: status === "sent" ? new Date().toISOString() : null,
      })
      .select("id")
      .single();

    if (docError || !document) {
      return NextResponse.json(
        { error: `Failed to create document: ${docError?.message ?? "unknown"}` },
        { status: 500 }
      );
    }

    // Link job → document (originating estimate) when we created or were given a job.
    if (jobId) {
      const { error: linkError } = await supabase
        .from("jobs")
        .update({ document_id: document.id })
        .eq("id", jobId)
        .is("document_id", null);
      if (linkError) {
        console.error(`[ingest/quote] couldn't link job ${jobId}:`, linkError);
      }
    }

    await syncDocumentToGraph(document.id);

    return NextResponse.json({
      ok: true,
      customerId,
      customerMatchedBy,
      propertyId,
      jobId,
      documentId: document.id,
      docNumber,
      type,
      status,
      subtotal,
      tax,
      total,
      depositPercent,
      depositAmount: money(total * (depositPercent / 100)),
      lineItemCount: itemsForStorage.length,
      documentUrl: `${SITE_ORIGIN}/documents/${document.id}`,
      jobUrl: jobId ? `${SITE_ORIGIN}/jobs` : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[ingest/quote]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
