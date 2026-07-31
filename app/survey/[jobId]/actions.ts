"use server";

import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { notifyOwnerOfLowSurveyRating } from "@/lib/notify-owner";

export async function submitSurvey(formData: FormData) {
  const jobId = formData.get("job_id") as string;
  const rating = Number(formData.get("rating"));
  const comment = (formData.get("comment") as string)?.trim() || null;

  if (!jobId) throw new Error("Missing job");
  if (!rating || rating < 1 || rating > 5) throw new Error("Please select a rating");

  const { error } = await supabase.from("satisfaction_surveys").insert({
    job_id: jobId,
    rating,
    comment,
  });
  // A repeat visit to the same link hits the unique job_id constraint —
  // treat that as "already submitted" rather than a hard error.
  if (error && !error.message.toLowerCase().includes("duplicate key")) {
    throw new Error(error.message);
  }

  if (rating <= 3) {
    const { data: job } = await supabase
      .from("jobs")
      .select("customers(name)")
      .eq("id", jobId)
      .single();
    const customers = job?.customers as unknown as { name: string }[] | null;
    await notifyOwnerOfLowSurveyRating({
      customerName: customers?.[0]?.name ?? "A customer",
      rating,
      comment,
    });
  }

  redirect(`/survey/${jobId}?rating=${rating}`);
}
