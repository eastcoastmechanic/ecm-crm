import { supabase } from "@/lib/supabase";
import { resend, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from "@/lib/resend";
import { one } from "@/lib/appointment-reminder";

type PropertyWithCustomer = {
  address: string | null;
  customers: { name: string | null; email: string | null } | { name: string | null; email: string | null }[] | null;
};

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

/** Emails the customer when equipment's manufacturer warranty is within 60 days of expiring. */
export async function sendWarrantyAlerts() {
  const in60Days = new Date();
  in60Days.setDate(in60Days.getDate() + 60);

  const { data: items, error } = await supabase
    .from("equipment")
    .select("id, type, brand, model, warranty_expiration, properties(address, customers(name, email))")
    .not("warranty_expiration", "is", null)
    .gte("warranty_expiration", todayISODate())
    .lte("warranty_expiration", in60Days.toISOString().slice(0, 10))
    .is("warranty_alert_sent_at", null);

  if (error) return { sent: 0, errors: [error.message] };

  const errors: string[] = [];
  let sent = 0;

  for (const item of items ?? []) {
    // equipment -> property -> customer are each many-to-one, so Supabase returns
    // objects, not arrays. Reading [0] found nothing and no warranty email ever went out.
    const property = one(item.properties as unknown as PropertyWithCustomer | PropertyWithCustomer[] | null);
    const customer = one(property?.customers);
    const email = customer?.email;
    if (!email) continue;

    const label = [item.brand, item.model, item.type].filter(Boolean).join(" ") || "your equipment";

    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      replyTo: RESEND_REPLY_TO,
      to: email,
      subject: `Your warranty is expiring soon`,
      text: `Hi ${customer?.name ?? ""},\n\nThe manufacturer warranty on ${label}${
        property?.address ? ` at ${property.address}` : ""
      } expires on ${item.warranty_expiration}. If anything's been off with it, now's a good time to have us take a look before coverage runs out.\n\nEast Coast Mechanical`,
    });

    if (sendError) {
      errors.push(`equipment ${item.id}: ${sendError.message}`);
      continue;
    }

    await supabase
      .from("equipment")
      .update({ warranty_alert_sent_at: new Date().toISOString() })
      .eq("id", item.id);
    sent++;
  }

  return { sent, errors };
}

