"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabase as adminDb } from "@/lib/supabase";
import { portalCustomerFor, requirePortalUser } from "@/lib/portal-customer";
import { validateServiceRequest } from "@/lib/portal-view";
import { notifyOwnerOfWebLead } from "@/lib/notify-owner";
import { noteJobStep } from "@/lib/planner-connector";
import { etDateKey } from "@/lib/tz";

export type RequestState = { error?: string } | null;

/**
 * Customer asks for service from the portal. Returns { error } so the form keeps what they typed.
 * The customer only picks one of their own properties, a day, a window and says what's wrong; the
 * server sets everything else on the job and saves it with the service client (the customer's
 * own session can't insert jobs after SQL 0070).
 */
export async function requestService(_prev: RequestState, formData: FormData): Promise<RequestState> {
  const user = await requirePortalUser();

  const customer = await portalCustomerFor(user.id);
  if (!customer) return { error: "Your login isn't linked to a customer account yet. Please call us and we'll fix it." };

  const { data: properties, error: propertiesError } = await adminDb
    .from("properties")
    .select("id, address")
    .eq("customer_id", customer.id);
  if (propertiesError) {
    console.error("requestService: property lookup failed", propertiesError.message);
    return { error: "Couldn't send your request. Please try again, or call us." };
  }

  const checked = validateServiceRequest(
    {
      propertyId: String(formData.get("property_id") ?? ""),
      date: String(formData.get("date") ?? ""),
      window: String(formData.get("window") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    },
    { today: etDateKey(), propertyIds: (properties ?? []).map((p) => p.id as string) }
  );
  if (!checked.ok) return { error: checked.error };

  const { data: newJob, error } = await adminDb
    .from("jobs")
    .insert({
      customer_id: customer.id,
      property_id: checked.propertyId,
      scheduled_at: checked.scheduledAt.toISOString(),
      status: "requested",
      created_via: "portal",
      notes: checked.notes,
    })
    .select("id")
    .single();

  if (error) {
    console.error("requestService: insert failed", error.message);
    return { error: "Couldn't send your request. Please try again, or call us." };
  }

  // A card on the Jobs plan, labelled Lead + Portal. Never throws.
  if (newJob?.id) await noteJobStep(newJob.id as string, "requested");

  // The request is saved; a failed owner email shouldn't make the customer retry.
  try {
    const { data: contact } = await adminDb.from("customers").select("phone").eq("id", customer.id).maybeSingle();
    const address = (properties ?? []).find((p) => p.id === checked.propertyId)?.address as string | null | undefined;
    await notifyOwnerOfWebLead({
      source: "portal",
      customerName: customer.name ?? "A portal customer",
      phone: (contact?.phone as string | null | undefined) ?? null,
      address: address ?? "address not on file",
      description: checked.notes,
      scheduledAt: checked.scheduledAt,
    });
  } catch (err) {
    console.error("requestService: owner alert failed", err instanceof Error ? err.message : err);
  }

  revalidatePath("/portal");
  redirect("/portal");
}
