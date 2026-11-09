"use server";

import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { notifyOwnerOfLowSurveyRating } from "@/lib/notify-owner";
import { one } from "@/lib/appointment-reminder";

export type SurveyState = { error?: string } | null;

/** Post-job survey. Returns { error } so the customer sees the reason instead of a blank page. */
export async function submitSurvey(_prev: SurveyState, formData: FormData): Promise<SurveyState> {
  const jobId = String(formData.get("job_id") ?? "");
  const rating = Number(formData.get("rating"));
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 5000) || null;

  if (!jobId) return { error: "This survey link is missing its job. Please use the link from your text or email." };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: "Please pick a rating from 1 to 5." };

  const { error } = await supabase.from("satisfaction_surveys").insert({
    job_id: jobId,
    rating,
    comment,
  });
  // A repeat visit to the same link hits the unique job_id constraint: treat
  // that as "already submitted", and don't alert the owner a second time.
  const duplicate = !!error && error.message.toLowerCase().includes("duplicate key");
  if (error && !duplicate) {
    console.error("submitSurvey: insert failed", error.message);
    return { error: "Sorry, we couldn't save your answer. Please try again." };
  }

  if (!duplicate && rating <= 3) {
    try {
      const { data: job } = await supabase.from("jobs").select("customers(name)").eq("id", jobId).maybeSingle();
      // A job has one customer; Supabase returns it as an object, not a list.
      const customer = one(job?.customers as { name: string | null } | { name: string | null }[] | null);
      await notifyOwnerOfLowSurveyRating({
        customerName: customer?.name ?? "A customer",
        rating,
        comment,
      });
    } catch (err) {
      // The answer is saved; a failed alert shouldn't make the customer retry.
      console.error("submitSurvey: owner alert failed", err instanceof Error ? err.message : err);
    }
  }

  redirect(`/survey/${jobId}?rating=${rating}`);
}
