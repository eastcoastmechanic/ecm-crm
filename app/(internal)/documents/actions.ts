"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { cascadeUnlinkDocuments } from "@/lib/cascade-delete";
import { deleteDocumentFromGraph } from "@/lib/graph-connector";

export async function deleteDocument(id: string): Promise<{ error?: string }> {
  if (!id) return { error: "Missing document id" };

  try {
    await cascadeUnlinkDocuments([id]);
    const { error } = await supabase.from("documents").delete().eq("id", id);
    if (error) {
      // Last pass: if a job snuck in between the unlink and the delete, clear
      // again and retry once so the staff action actually goes through.
      if (error.message.includes("jobs_document_id_fkey")) {
        await cascadeUnlinkDocuments([id]);
        const retry = await supabase.from("documents").delete().eq("id", id);
        if (retry.error) return { error: retry.error.message };
      } else {
        return { error: error.message };
      }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete document" };
  }

  await deleteDocumentFromGraph(id);

  revalidatePath("/documents");
  revalidatePath("/jobs");
  revalidatePath("/diagnostics");
  revalidatePath("/customers");
  return {};
}
