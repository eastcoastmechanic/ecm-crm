"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { stripe } from "@/lib/stripe";

export async function createCheckoutSession(formData: FormData) {
  const documentId = formData.get("document_id") as string;
  const supabase = await createPortalServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/login");

  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, doc_number, type, status, total")
    .eq("id", documentId)
    .single();

  if (error || !doc) throw new Error("Invoice not found");
  if (doc.type !== "invoice") throw new Error("Only invoices can be paid online");
  if (doc.status === "paid") throw new Error("This invoice is already paid");
  if (!doc.total || doc.total <= 0) throw new Error("This invoice has no amount due");

  const origin = (await headers()).get("origin");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: Math.round(doc.total * 100),
          product_data: {
            name: `Invoice ${doc.doc_number ?? doc.id} — East Coast Mechanical`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      document_id: doc.id,
    },
    success_url: `${origin}/portal/documents/${doc.id}?paid=1`,
    cancel_url: `${origin}/portal/documents/${doc.id}`,
  });

  if (!session.url) throw new Error("Could not start checkout session");
  redirect(session.url);
}
