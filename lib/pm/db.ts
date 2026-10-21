import { supabase } from "@/lib/supabase";
import { signStoredPhotos } from "@/lib/photo-urls";
import { BUSINESS_TZ } from "@/lib/tz";
import { NAMEPLATE_PHOTO_BUCKET, PM_PHOTO_BUCKET } from "@/lib/pm/photos";
import {
  buildReportModel,
  documentSnapshot,
  openItemLabels,
  summarizeItems,
  toReportItem,
  type PmSummary,
} from "@/lib/pm/report";
import { checklistSaveSchema, isPmResult, itemsFromTemplate, parseTemplateItems, type ChecklistSave } from "@/lib/pm/schema";
import type { TruckPmChecklist } from "@/lib/pm/truck-hook";
import type { PmChecklistItem, PmPhoto, PmReadingField, PmReportModel, PmResult } from "@/lib/pm/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID.test(value);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function asRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const readings: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" || typeof entry === "number") readings[key] = String(entry);
  }
  return readings;
}

function asFields(value: unknown): PmReadingField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((field) => {
    if (!field || typeof field !== "object") return [];
    const row = field as Partial<PmReadingField>;
    if (!row.key || !row.label || (row.input !== "number" && row.input !== "text")) return [];
    return [{ key: row.key, label: row.label, input: row.input, ...(row.unit ? { unit: row.unit } : {}) }];
  });
}

function asPhotos(value: unknown): PmPhoto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((photo) => {
    if (!photo || typeof photo !== "object" || typeof (photo as PmPhoto).path !== "string") return [];
    const row = photo as PmPhoto;
    return [{ path: row.path, caption: row.caption ?? null, taken_at: row.taken_at }];
  });
}

function asResult(value: unknown): PmResult | null {
  return isPmResult(value) ? value : null;
}

export type ChecklistItemRow = PmChecklistItem & { id: string };

export type ChecklistDetail = {
  id: string;
  job_id: string;
  equipment_id: string;
  template_slug: string | null;
  audience: "residential" | "commercial";
  tech_name: string | null;
  status: "draft" | "complete";
  recommendations: string | null;
  completed_at: string | null;
  document_id: string | null;
  created_at: string;
  customer_name: string;
  property_address: string | null;
  equipment_label: string;
  equipment_serial: string | null;
  doc_number: string | null;
  items: ChecklistItemRow[];
};

type ItemJoin = {
  id: string;
  item_key: string;
  section: string;
  label: string;
  help: string | null;
  sort_order: number;
  result: string | null;
  readings: unknown;
  reading_fields: unknown;
  notes: string | null;
  photos: unknown;
};

function mapItem(row: ItemJoin): ChecklistItemRow {
  return {
    id: row.id,
    item_key: row.item_key,
    section: row.section,
    label: row.label,
    help: row.help,
    sort_order: row.sort_order,
    result: asResult(row.result),
    readings: asRecord(row.readings),
    reading_fields: asFields(row.reading_fields),
    notes: row.notes,
    photos: asPhotos(row.photos),
  };
}

function equipmentLabel(equipment: { type?: string | null; brand?: string | null; model?: string | null } | null): string {
  if (!equipment) return "Equipment";
  return [equipment.type, equipment.brand, equipment.model].filter(Boolean).join(" ") || "Equipment";
}

const CHECKLIST_SELECT = `
  id, job_id, equipment_id, template_slug, audience, tech_name, status, recommendations,
  completed_at, document_id, created_at,
  customers(name),
  properties(address),
  equipment(type, brand, model, serial_number),
  documents(doc_number),
  pm_checklist_items(id, item_key, section, label, help, sort_order, result, readings, reading_fields, notes, photos)
`;

function mapChecklist(row: Record<string, unknown>): ChecklistDetail {
  const customer = one(row.customers as { name: string | null } | { name: string | null }[] | null);
  const property = one(row.properties as { address: string | null } | { address: string | null }[] | null);
  const equipment = one(
    row.equipment as
      | { type: string | null; brand: string | null; model: string | null; serial_number: string | null }
      | null
  );
  const document = one(row.documents as { doc_number: string | null } | { doc_number: string | null }[] | null);
  const items = ((row.pm_checklist_items as ItemJoin[] | null) ?? []).map(mapItem);
  items.sort((a, b) => a.sort_order - b.sort_order);
  return {
    id: String(row.id),
    job_id: String(row.job_id),
    equipment_id: String(row.equipment_id),
    template_slug: (row.template_slug as string | null) ?? null,
    audience: row.audience === "commercial" ? "commercial" : "residential",
    tech_name: (row.tech_name as string | null) ?? null,
    status: row.status === "complete" ? "complete" : "draft",
    recommendations: (row.recommendations as string | null) ?? null,
    completed_at: (row.completed_at as string | null) ?? null,
    document_id: (row.document_id as string | null) ?? null,
    created_at: String(row.created_at),
    customer_name: customer?.name || "Customer",
    property_address: property?.address ?? null,
    equipment_label: equipmentLabel(equipment),
    equipment_serial: equipment?.serial_number ?? null,
    doc_number: document?.doc_number ?? null,
    items,
  };
}

export async function listChecklists(): Promise<{ rows: ChecklistDetail[]; error: string | null }> {
  const { data, error } = await supabase
    .from("pm_checklists")
    .select(CHECKLIST_SELECT)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []).map((row) => mapChecklist(row as Record<string, unknown>)), error: null };
}

export async function getChecklist(id: string): Promise<{ row: ChecklistDetail | null; error: string | null }> {
  const { data, error } = await supabase.from("pm_checklists").select(CHECKLIST_SELECT).eq("id", id).maybeSingle();
  if (error) return { row: null, error: error.message };
  if (!data) return { row: null, error: null };
  return { row: mapChecklist(data as Record<string, unknown>), error: null };
}

export function reportDateLabel(iso: string | null): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(iso ? new Date(iso) : new Date());
}

export async function checklistReport(row: ChecklistDetail): Promise<PmReportModel> {
  const items = await Promise.all(
    row.items.map(async (item) => {
      const signed = await signStoredPhotos(
        item.photos.map((photo) => ({ path: photo.path, caption: photo.caption ?? null, url: null })),
        { defaultBucket: PM_PHOTO_BUCKET }
      );
      return toReportItem(
        item,
        signed.map((photo) => ({ url: photo.url ?? null, caption: photo.caption ?? null }))
      );
    })
  );
  return buildReportModel({
    checklist_id: row.id,
    doc_number: row.doc_number,
    date_label: reportDateLabel(row.completed_at ?? row.created_at),
    tech_name: row.tech_name,
    customer_name: row.customer_name,
    property_address: row.property_address,
    equipment_label: row.equipment_label,
    equipment_serial: row.equipment_serial,
    audience_label: row.audience === "commercial" ? "Commercial" : "Residential",
    recommendations: row.recommendations,
    items,
  });
}

export async function signNameplatePhoto(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const [signed] = await signStoredPhotos([{ path, url: null }], { defaultBucket: NAMEPLATE_PHOTO_BUCKET });
  return signed?.url ?? null;
}

async function writeChecklistText(id: string, save: ChecklistSave) {
  const { error } = await supabase
    .from("pm_checklists")
    .update({
      tech_name: save.tech_name || null,
      recommendations: save.recommendations.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await Promise.all(
    save.items.map(async (item) => {
      const { error: itemError } = await supabase
        .from("pm_checklist_items")
        .update({
          result: item.result,
          notes: item.notes?.trim() || null,
          readings: item.readings,
        })
        .eq("checklist_id", id)
        .eq("item_key", item.item_key);
      if (itemError) throw new Error(itemError.message);
    })
  );
}

export async function saveChecklist(id: string, payload: unknown): Promise<{ error?: string }> {
  const parsed = checklistSaveSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Could not read the checklist" };
  try {
    await writeChecklistText(id, parsed.data);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save the checklist" };
  }
  return {};
}

async function nextPmNumber(): Promise<string> {
  const { count } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("type", "pm_report");
  return `PM-${1001 + (count ?? 0)}`;
}

export async function completeChecklist(id: string, payload: unknown): Promise<{ error?: string; documentId?: string }> {
  const saved = await saveChecklist(id, payload);
  if (saved.error) return saved;

  const { row, error } = await getChecklist(id);
  if (error) return { error };
  if (!row) return { error: "Checklist not found" };
  if (!row.tech_name?.trim()) return { error: "Enter the technician's name before filing the report." };

  const open = openItemLabels(row.items);
  if (open.length > 0) {
    const preview = open.slice(0, 4).join(", ");
    const more = open.length > 4 ? ` and ${open.length - 4} more` : "";
    return { error: `Mark every item pass, fail, or NA. Still open: ${preview}${more}.` };
  }

  const snapshot = documentSnapshot({
    checklist_id: row.id,
    template_slug: row.template_slug,
    tech_name: row.tech_name,
    recommendations: row.recommendations,
    items: row.items,
  });

  const { data: checklist } = await supabase
    .from("pm_checklists")
    .select("customer_id, property_id, job_id, document_id")
    .eq("id", id)
    .single();

  let documentId = checklist?.document_id as string | null;
  if (documentId) {
    const { error: updateError } = await supabase
      .from("documents")
      .update({ line_items: snapshot, customer_id: checklist?.customer_id, property_id: checklist?.property_id, job_id: checklist?.job_id })
      .eq("id", documentId);
    if (updateError) return { error: updateError.message };
  } else {
    const docNumber = await nextPmNumber();
    const { data: doc, error: insertError } = await supabase
      .from("documents")
      .insert({
        type: "pm_report",
        doc_number: docNumber,
        customer_id: checklist?.customer_id ?? null,
        property_id: checklist?.property_id ?? null,
        job_id: checklist?.job_id ?? null,
        status: "draft",
        line_items: snapshot,
        subtotal: null,
        tax: null,
        total: null,
        ai_generated: false,
      })
      .select("id")
      .single();
    if (insertError) {
      return {
        error: insertError.message.includes("documents_type_check")
          ? "The database is missing the pm_report document type. Apply db/migrations/0048_preventive_maintenance.sql."
          : insertError.message,
      };
    }
    documentId = doc.id;
  }

  const completedAt = row.completed_at ?? new Date().toISOString();
  const { error: statusError } = await supabase
    .from("pm_checklists")
    .update({
      status: "complete",
      completed_at: completedAt,
      document_id: documentId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (statusError) return { error: statusError.message };
  return { documentId: documentId ?? undefined };
}

export async function attachItemPhoto(
  checklistId: string,
  itemKey: string,
  path: string
): Promise<{ error?: string }> {
  const { data, error } = await supabase
    .from("pm_checklist_items")
    .select("photos")
    .eq("checklist_id", checklistId)
    .eq("item_key", itemKey)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Checklist item not found" };
  const photos = asPhotos(data.photos);
  photos.push({ path, caption: null, taken_at: new Date().toISOString() });
  const { error: updateError } = await supabase
    .from("pm_checklist_items")
    .update({ photos })
    .eq("checklist_id", checklistId)
    .eq("item_key", itemKey);
  if (updateError) return { error: updateError.message };
  return {};
}

export async function createChecklist(input: {
  jobId: string;
  equipmentId: string;
  templateId: string;
  techName: string;
}): Promise<{ id?: string; error?: string }> {
  const [{ data: job, error: jobError }, { data: equipment, error: equipmentError }, { data: template, error: templateError }] =
    await Promise.all([
      supabase.from("jobs").select("id, customer_id, property_id, job_type").eq("id", input.jobId).maybeSingle(),
      supabase.from("equipment").select("id, property_id").eq("id", input.equipmentId).maybeSingle(),
      supabase.from("pm_templates").select("id, slug, audience, items").eq("id", input.templateId).maybeSingle(),
    ]);
  if (jobError) return { error: jobError.message };
  if (equipmentError) return { error: equipmentError.message };
  if (templateError) return { error: templateError.message };
  if (!job) return { error: "Choose a job." };
  if (!equipment) return { error: "Choose the equipment." };
  if (!template) return { error: "Choose a checklist template." };
  if (job.property_id && equipment.property_id && job.property_id !== equipment.property_id) {
    return { error: "That equipment is not on this job's property." };
  }

  const parsed = parseTemplateItems(template.items);
  if (!parsed.items) return { error: parsed.error ?? "That template has no items." };
  const audience = template.audience === "commercial" ? "commercial" : "residential";

  const { data: checklist, error } = await supabase
    .from("pm_checklists")
    .insert({
      job_id: job.id,
      equipment_id: equipment.id,
      customer_id: job.customer_id,
      property_id: job.property_id,
      template_id: template.id,
      template_slug: template.slug,
      audience,
      tech_name: input.techName.trim() || null,
      status: "draft",
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const rows = itemsFromTemplate(parsed.items).map((item) => ({
    checklist_id: checklist.id,
    item_key: item.item_key,
    section: item.section,
    label: item.label,
    help: item.help,
    sort_order: item.sort_order,
    result: null,
    readings: item.readings,
    reading_fields: item.reading_fields,
    notes: null,
    photos: [],
  }));
  const { error: itemError } = await supabase.from("pm_checklist_items").insert(rows);
  if (itemError) {
    await supabase.from("pm_checklists").delete().eq("id", checklist.id);
    return { error: itemError.message };
  }
  return { id: checklist.id };
}

export async function truckChecklists(jobId: string | null): Promise<{ rows: TruckPmChecklist[]; error: string | null }> {
  let query = supabase
    .from("pm_checklists")
    .select(
      "id, status, job_id, equipment_id, template_slug, tech_name, completed_at, document_id, documents(doc_number), pm_templates(name), pm_checklist_items(item_key, label, section, result, notes)"
    )
    .order("created_at", { ascending: false })
    .limit(25);
  if (jobId) query = query.eq("job_id", jobId);
  const { data, error } = await query;
  if (error) return { rows: [], error: error.message };

  const rows: TruckPmChecklist[] = (data ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    const items = ((record.pm_checklist_items as { item_key: string; label: string; section: string; result: string | null; notes: string | null }[]) ?? []);
    const summary: PmSummary = summarizeItems(items.map((item) => ({ result: asResult(item.result) })));
    const document = one(record.documents as { doc_number: string | null } | { doc_number: string | null }[] | null);
    const template = one(record.pm_templates as { name: string | null } | { name: string | null }[] | null);
    const id = String(record.id);
    return {
      id,
      status: record.status === "complete" ? "complete" : "draft",
      job_id: String(record.job_id),
      equipment_id: String(record.equipment_id),
      template: {
        slug: (record.template_slug as string | null) ?? null,
        name: template?.name ?? null,
      },
      tech_name: (record.tech_name as string | null) ?? null,
      completed_at: (record.completed_at as string | null) ?? null,
      document_id: (record.document_id as string | null) ?? null,
      doc_number: document?.doc_number ?? null,
      report_path: `/pm/${id}/report`,
      checklist_path: `/pm/${id}`,
      summary,
      failures: items
        .filter((item) => item.result === "fail")
        .map((item) => ({
          key: item.item_key,
          label: item.label,
          section: item.section,
          notes: item.notes,
        })),
    };
  });
  return { rows, error: null };
}

export async function getChecklistIdForDocument(documentId: string): Promise<string | null> {
  const { data } = await supabase.from("pm_checklists").select("id").eq("document_id", documentId).maybeSingle();
  return data?.id ?? null;
}
