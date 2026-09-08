"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { cascadeUnlinkDocuments } from "@/lib/cascade-delete";
import { deleteDocumentFromGraph } from "@/lib/graph-connector";

export async function deleteDocument(id: string): Promise<{ error?: string }> {
  if (!id) return { error: "Missing document id" };

  try {
    await cascadeUnlinkDocuments([id]);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not unlink related jobs" };
  }

  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) return { error: error.message };

  await deleteDocumentFromGraph(id);

  revalidatePath("/documents");
  revalidatePath("/jobs");
  revalidatePath("/diagnostics");
  revalidatePath("/customers");
  return {};
}
