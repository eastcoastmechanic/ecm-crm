"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function updateJobStatus(formData: FormData) {
  const id = formData.get("id") as string;
  const status = formData.get("status") as string;

  const { data: existing, error: fetchError } = await supabase
    .from("jobs")
    .select("completed_at")
    .eq("id", id)
    .single();
  if (fetchError) throw new Error(fetchError.message);

  const { error } = await supabase
    .from("jobs")
    .update({
      status,
      completed_at:
        status === "complete" ? existing.completed_at ?? new Date().toISOString() : existing.completed_at,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath("/jobs");
}

export async function rescheduleJob(jobId: string, newDate: string) {
  const { data: existing, error: fetchError } = await supabase
    .from("jobs")
    .select("scheduled_at")
    .eq("id", jobId)
    .single();
  if (fetchError) throw new Error(fetchError.message);

  const [year, month, day] = newDate.split("-").map(Number);
  const next = existing.scheduled_at ? new Date(existing.scheduled_at) : new Date(year, month - 1, day, 9, 0, 0);
  next.setFullYear(year, month - 1, day);

  const { error } = await supabase
    .from("jobs")
    .update({ scheduled_at: next.toISOString() })
    .eq("id", jobId);
  if (error) throw new Error(error.message);

  revalidatePath("/jobs");
}
