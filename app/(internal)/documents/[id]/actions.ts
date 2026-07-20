"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { getDocumentForPdf } from "@/lib/documents";
import { renderDocumentPdf } from "@/lib/pdf";
import { resend, RESEND_FROM_EMAIL } from "@/lib/resend";

type LineItem = {
  category: string;
  description: string;
  price_book_item_name: string | null;
  qty: number;
  unit: string;
  good: number | null;
  better: number | null;
  best: number | null;
  notes: string | null;
};

function parseNullableNumber(value: FormDataEntryValue | null): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sumTier(items: LineItem[], tier: "good" | "better" | "best") {
  const total = items.reduce((sum, item) => {
    const price = item[tier];
    return price === null ? sum : sum + price * item.qty;
  }, 0);
  return Math.round(total * 100) / 100;
}

export async function updateDocument(formData: FormData) {
  const id = formData.get("id") as string;
  const status = formData.get("status") as string;
  const itemCount = Number(formData.get("item_count") ?? 0);

  const { data: existing, error: fetchError } = await supabase
    .from("documents")
    .select("line_items")
    .eq("id", id)
    .single();
  if (fetchError) throw new Error(fetchError.message);

  const existingData = existing.line_items as {
    items: LineItem[];
    brand: unknown;
    mass_save_eligible: boolean;
    mass_save_note: string | null;
  };

  const items: LineItem[] = [];
  for (let i = 0; i < itemCount; i++) {
    items.push({
      category: (formData.get(`category_${i}`) as string) ?? "",
      description: (formData.get(`description_${i}`) as string) ?? "",
      price_book_item_name: (formData.get(`price_book_item_name_${i}`) as string) || null,
      qty: Number(formData.get(`qty_${i}`)) || 0,
      unit: (formData.get(`unit_${i}`) as string) ?? "EA",
      good: parseNullableNumber(formData.get(`good_${i}`)),
      better: parseNullableNumber(formData.get(`better_${i}`)),
      best: parseNullableNumber(formData.get(`best_${i}`)),
      notes: (formData.get(`notes_${i}`) as string) || null,
    });
  }

  const totals = {
    good: sumTier(items, "good"),
    better: sumTier(items, "better"),
    best: sumTier(items, "best"),
  };

  const { error } = await supabase
    .from("documents")
    .update({
      status,
      line_items: {
        ...existingData,
        items,
        totals,
      },
      subtotal: totals.better,
      tax: 0,
      total: totals.better,
      sent_at: status === "sent" ? new Date().toISOString() : undefined,
      paid_at: status === "paid" ? new Date().toISOString() : undefined,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath(`/documents/${id}`);
  revalidatePath("/documents");
}

const typeLabel: Record<string, string> = {
  estimate: "Estimate",
  invoice: "Invoice",
  proposal: "Proposal",
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export async function sendDocumentEmail(formData: FormData) {
  const id = formData.get("id") as string;

  const { data, customerEmail, error } = await getDocumentForPdf(id);
  if (error || !data) throw new Error(error ?? "Document not found");
  if (!customerEmail) throw new Error("Customer has no email on file");

  const pdfBuffer = await renderDocumentPdf(data);
  const label = typeLabel[data.type] ?? "Document";

  const { error: sendError } = await resend.emails.send({
    from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
    to: customerEmail,
    subject: `${label} ${data.doc_number ?? ""} from East Coast Mechanical`,
    text: `Hi ${data.customer_name},\n\nAttached is your ${label.toLowerCase()} ${data.doc_number ?? ""} (Better tier total: ${formatPrice(
      data.totals.better
    )}).\n\nLet us know if you have any questions.\n\nEast Coast Mechanical`,
    attachments: [
      {
        filename: `${data.doc_number ?? label}.pdf`,
        content: pdfBuffer,
      },
    ],
  });

  if (sendError) throw new Error(sendError.message);

  const { error: updateError } = await supabase
    .from("documents")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id);

  if (updateError) throw new Error(updateError.message);

  revalidatePath(`/documents/${id}`);
  revalidatePath("/documents");
}
