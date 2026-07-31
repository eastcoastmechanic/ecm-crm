"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function deleteDocument(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/documents");
  return {};
}
