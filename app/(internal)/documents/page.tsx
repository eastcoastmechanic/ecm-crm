import Link from "next/link";
import { supabase } from "@/lib/supabase";
import DocumentsList from "./DocumentsList";
import { buttonClass, buttonSecondaryClass, errorClass, headingClass, subTextClass } from "../ui";

export default async function DocumentsPage() {
  const { data: documents, error } = await supabase
    .from("documents")
    .select("*, customers(name)")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Documents</h1>
          <p className={subTextClass}>
            AI-generated estimates, invoices, proposals, and equipment condition assessments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/documents/mass-save-rebate/new" className={buttonSecondaryClass}>
            + New Mass Save Rebate
          </Link>
          <Link href="/documents/warranty/new" className={buttonSecondaryClass}>
            + New Warranty
          </Link>
          <Link href="/documents/assessment/new" className={buttonSecondaryClass}>
            + New Condition Assessment
          </Link>
          <Link href="/documents/new" className={buttonClass}>
            New Document
          </Link>
        </div>
      </div>

      {error && (
        <p className={errorClass}>Error loading documents: {error.message}</p>
      )}

      <DocumentsList documents={documents ?? []} />
    </div>
  );
}
