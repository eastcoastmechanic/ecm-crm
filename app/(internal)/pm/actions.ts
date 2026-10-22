"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOffice } from "@/lib/require-role";
import { signStoredPhotos } from "@/lib/photo-urls";
import {
  attachItemPhoto,
  completeChecklist,
  createChecklist,
  isUuid,
  saveChecklist,
} from "@/lib/pm/db";
import { PM_PHOTO_BUCKET, uploadPrivatePhoto } from "@/lib/pm/photos";
import { parseTemplateItems } from "@/lib/pm/schema";
import { supabase } from "@/lib/supabase";

function refresh(id?: string) {
  revalidatePath("/pm");
  if (id) {
    revalidatePath(`/pm/${id}`);
    revalidatePath(`/pm/${id}/report`);
  }
}

export async function startPmChecklist(formData: FormData) {
  const jobId = String(formData.get("job_id") ?? "");
  const equipmentId = String(formData.get("equipment_id") ?? "");
  const templateId = String(formData.get("template_id") ?? "");
  const techName = String(formData.get("tech_name") ?? "");
  if (!isUuid(jobId) || !isUuid(equipmentId) || !isUuid(templateId)) {
    return { error: "Choose a job, the equipment, and a template." };
  }
  const created = await createChecklist({ jobId, equipmentId, templateId, techName });
  if (created.error || !created.id) return { error: created.error ?? "Could not start the checklist" };
  refresh(created.id);
  redirect(`/pm/${created.id}`);
}

export async function savePmChecklist(checklistId: string, payload: unknown) {
  if (!isUuid(checklistId)) return { error: "Missing checklist" };
  const result = await saveChecklist(checklistId, payload);
  if (!result.error) refresh(checklistId);
  return result;
}

export async function filePmReport(checklistId: string, payload: unknown) {
  if (!isUuid(checklistId)) return { error: "Missing checklist" };
  const result = await completeChecklist(checklistId, payload);
  if (result.error) return result;
  refresh(checklistId);
  revalidatePath("/documents");
  redirect(`/pm/${checklistId}/report`);
}

export async function uploadChecklistPhoto(
  checklistId: string,
  itemKey: string,
  formData: FormData
): Promise<{ error?: string; path?: string; url?: string | null }> {
  if (!isUuid(checklistId) || !/^[a-z0-9_]+$/.test(itemKey)) return { error: "Missing checklist item" };
  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return { error: "Choose a photo." };
  if (!photo.type.startsWith("image/")) return { error: "That file is not a photo." };
  if (photo.size > 4_500_000) return { error: "Photo is too large after resizing. Try again." };
  try {
    const path = await uploadPrivatePhoto(PM_PHOTO_BUCKET, photo, checklistId);
    const saved = await attachItemPhoto(checklistId, itemKey, path);
    if (saved.error) return saved;
    const [signed] = await signStoredPhotos([{ path, url: null, caption: null }], { defaultBucket: PM_PHOTO_BUCKET });
    refresh(checklistId);
    return { path, url: signed?.url ?? null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not upload the photo" };
  }
}

export async function savePmTemplate(templateId: string, items: unknown) {
  await requireOffice();
  if (!isUuid(templateId)) return { error: "Missing template" };
  const parsed = parseTemplateItems(items);
  if (!parsed.items) return { error: parsed.error ?? "Template items are not valid" };
  const { error } = await supabase
    .from("pm_templates")
    .update({ items: parsed.items, updated_at: new Date().toISOString() })
    .eq("id", templateId);
  if (error) return { error: error.message };
  revalidatePath("/pm/templates");
  revalidatePath("/pm/new");
  return {};
}
