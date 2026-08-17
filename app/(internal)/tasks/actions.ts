"use server";

import { revalidatePath } from "next/cache";
import { createPlannerTask, completePlannerTask } from "@/lib/planner-connector";

export async function addTask(formData: FormData) {
  const title = (formData.get("title") as string)?.trim();
  const notes = (formData.get("notes") as string)?.trim();
  const due_date = formData.get("due_date") as string;

  if (!title) throw new Error("Title is required");

  await createPlannerTask({
    title,
    notes: notes || undefined,
    dueDate: due_date || undefined,
    bucket: "tasks",
  });

  revalidatePath("/tasks");
}

export async function completeTask(id: string): Promise<{ error?: string }> {
  const ok = await completePlannerTask(id);
  if (!ok) return { error: "Failed to complete task." };

  revalidatePath("/tasks");
  return {};
}
