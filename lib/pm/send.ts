import { supabase } from "@/lib/supabase";
import { resend, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from "@/lib/resend";
import { checklistReport, getChecklist, getChecklistIdForDocument } from "@/lib/pm/db";
import { renderPmReportPdf } from "@/lib/pm/report-pdf";

function relatedEmail(value: { email: string | null; name: string | null } | { email: string | null; name: string | null }[] | null) {
  if (!value) return { email: null, name: "Customer" };
  const row = Array.isArray(value) ? value[0] : value;
  return { email: row?.email ?? null, name: row?.name ?? "Customer" };
}

/** Emails the filed PM report. Marks the document sent so it matches the other document send paths. */
export async function sendPmReportToCustomer(documentId: string) {
  const checklistId = await getChecklistIdForDocument(documentId);
  if (!checklistId) throw new Error("That PM report is not linked to a checklist.");

  const [{ row, error }, docResult] = await Promise.all([
    getChecklist(checklistId),
    supabase.from("documents").select("doc_number, customers(name, email)").eq("id", documentId).single(),
  ]);
  if (error || !row) throw new Error(error ?? "Checklist not found");
  if (docResult.error || !docResult.data) throw new Error(docResult.error?.message ?? "Document not found");

  const customer = relatedEmail(docResult.data.customers);
  if (!customer.email) throw new Error("Customer has no email on file");

  const report = await checklistReport(row);
  const pdf = await renderPmReportPdf(report);
  const docNumber = report.doc_number ?? docResult.data.doc_number ?? "PM report";

  const { error: sendError } = await resend.emails.send({
    from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
    replyTo: RESEND_REPLY_TO,
    to: customer.email,
    subject: `${docNumber} from East Coast Mechanical`,
    text: `Hi ${customer.name},\n\nAttached is the preventive maintenance report from your visit.\n\nEast Coast Mechanical\n(774) 343-6369`,
    attachments: [{ filename: `${docNumber}.pdf`, content: pdf }],
  });
  if (sendError) throw new Error(sendError.message);

  const { error: updateError } = await supabase
    .from("documents")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", documentId);
  if (updateError) throw new Error(updateError.message);
}
