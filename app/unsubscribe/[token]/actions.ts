"use server";

import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UnsubscribeState = { error?: string };

// Public: the private link is the only credential. Stops campaign emails for
// this customer. It does not touch texting (that's STOP by text) or job emails
// such as invoices and appointment notices.
export async function unsubscribe(_prev: UnsubscribeState, formData: FormData): Promise<UnsubscribeState> {
  const token = String(formData.get("token") ?? "");
  if (!UUID.test(token)) return { error: "This link isn't valid. Reply to the email and we'll take you off." };

  const { error } = await supabase
    .from("customers")
    .update({ email_opt_out_at: new Date().toISOString() })
    .eq("unsubscribe_token", token)
    .is("email_opt_out_at", null);
  if (error) return { error: "Something went wrong. Reply to the email and we'll take you off." };
  redirect(`/unsubscribe/${token}`);
}
