import { z } from "zod";
import type { PmChecklistItem, PmReadingField, PmResult, PmTemplateItem } from "@/lib/pm/types";

const readingFieldSchema = z.object({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  unit: z.string().trim().max(20).optional(),
  input: z.enum(["number", "text"]),
});

const templateItemSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores"),
  section: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  help: z.string().trim().max(400).optional(),
  readings: z.array(readingFieldSchema).max(8),
});

export const templateItemsSchema = z.array(templateItemSchema).min(1).max(80);

export function parseTemplateItems(value: unknown): { items?: PmTemplateItem[]; error?: string } {
  const parsed = templateItemsSchema.safeParse(value);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Template items are not valid" };
  }
  const keys = new Set<string>();
  for (const item of parsed.data) {
    if (keys.has(item.key)) return { error: `Duplicate item key: ${item.key}` };
    keys.add(item.key);
    const readingKeys = new Set<string>();
    for (const field of item.readings) {
      if (readingKeys.has(field.key)) return { error: `${item.label} has two readings named ${field.key}` };
      readingKeys.add(field.key);
    }
  }
  return {
    items: parsed.data.map((item) => ({
      key: item.key,
      section: item.section,
      label: item.label,
      ...(item.help ? { help: item.help } : {}),
      readings: item.readings.map((field) => ({
        key: field.key,
        label: field.label,
        input: field.input,
        ...(field.unit ? { unit: field.unit } : {}),
      })),
    })),
  };
}

const resultSchema = z.enum(["pass", "fail", "na"]).nullable();

const saveItemSchema = z.object({
  item_key: z.string().min(1),
  result: resultSchema,
  notes: z.string().max(2000).nullable(),
  readings: z.record(z.string(), z.string().max(40)),
});

export const checklistSaveSchema = z.object({
  tech_name: z.string().trim().max(80),
  recommendations: z.string().max(4000),
  items: z.array(saveItemSchema).min(1),
});

export type ChecklistSave = z.infer<typeof checklistSaveSchema>;

export function emptyReadings(fields: PmReadingField[]): Record<string, string> {
  const readings: Record<string, string> = {};
  for (const field of fields) readings[field.key] = "";
  return readings;
}

export function itemsFromTemplate(templateItems: PmTemplateItem[]): Omit<PmChecklistItem, "id">[] {
  return templateItems.map((item, index) => ({
    item_key: item.key,
    section: item.section,
    label: item.label,
    help: item.help ?? null,
    sort_order: index,
    result: null,
    readings: emptyReadings(item.readings),
    reading_fields: item.readings,
    notes: null,
    photos: [],
  }));
}

export function isPmResult(value: unknown): value is PmResult {
  return value === "pass" || value === "fail" || value === "na";
}
