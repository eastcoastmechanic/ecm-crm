"use server";

import { revalidatePath } from "next/cache";
import { requireOffice } from "@/lib/require-role";
import { createPlannerTask, completePlannerTask, plannerConfigured } from "@/lib/planner-connector";

/** Add a Planner task. Returns { error } (never throws) so the form keeps what was typed. */
export async function addTask(formData: FormData): Promise<{ error?: string }> {
  try {
    await requireOffice();
  } catch {
    return { error: "Only the office or owner can add tasks." };
  }
  const title = (formData.get("title") as string)?.trim();
  const notes = (formData.get("notes") as string)?.trim();
  const due_date = formData.get("due_date") as string;

  if (!title) return { error: "Title is required." };
  if (!plannerConfigured()) return { error: "Planner isn't set up yet, so tasks can't be added." };

  try {
    await createPlannerTask({
      title,
      notes: notes || undefined,
      dueDate: due_date || undefined,
      bucket: "tasks",
    });
  } catch (err) {
    console.error("addTask: Planner create failed", err instanceof Error ? err.message : err);
    return { error: "Couldn't add the task to Planner. Try again." };
  }

  revalidatePath("/tasks");
  return {};
}

export async function completeTask(id: string): Promise<{ error?: string }> {
  try {
    await requireOffice();
  } catch {
    return { error: "Only the office or owner can complete tasks." };
  }
  const ok = await completePlannerTask(id);
  if (!ok) return { error: "Failed to complete task." };

  revalidatePath("/tasks");
  return {};
}
