"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function addTask(formData: FormData) {
  const title = (formData.get("title") as string)?.trim();
  const notes = (formData.get("notes") as string)?.trim();
  const due_date = formData.get("due_date") as string;

  if (!title) throw new Error("Title is required");

  const { error } = await supabase.from("tasks").insert({
    title,
    notes: notes || null,
    due_at: due_date ? new Date(`${due_date}T12:00:00`).toISOString() : null,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/tasks");
}

export async function completeTask(id: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("tasks")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/tasks");
  return {};
}
