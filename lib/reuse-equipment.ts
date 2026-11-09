import { supabase } from "@/lib/supabase";

/**
 * A form that failed after saving new equipment sends that equipment's id back on
 * retry (hidden field), so the retry reuses it instead of making a duplicate. Only
 * trust the id if it really is equipment on this property; otherwise return null
 * and the caller creates the equipment as usual.
 */
export async function reusableEquipmentId(
  candidate: FormDataEntryValue | null,
  propertyId: string
): Promise<string | null> {
  const id = typeof candidate === "string" ? candidate.trim() : "";
  if (!id) return null;
  const { data } = await supabase
    .from("equipment")
    .select("id")
    .eq("id", id)
    .eq("property_id", propertyId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
