// Pushes every existing customer, job, and document into the Graph external
// connection created by graph-connector-setup.mjs. Run once after setup, and
// re-run any time you want to reconcile drift (e.g. after editing records
// directly in Supabase SQL Editor, which bypasses the app's live sync).
//
//   node scripts/graph-connector-backfill.mjs
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, getGraphToken, pushItem } from "./graph-connector-lib.mjs";

loadEnvLocal();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const SITE_ORIGIN = "https://eastcoastmechanical.org";

async function main() {
  const token = await getGraphToken();
  let pushed = 0;
  let failed = 0;

  console.log("Customers...");
  const { data: customers, error: custErr } = await supabase
    .from("customers")
    .select("id,name,email,phone,billing_address,notes");
  if (custErr) throw new Error(custErr.message);
  for (const c of customers) {
    const ok = await pushItem(token, {
      type: "customer",
      id: c.id,
      title: c.name ?? "Customer",
      content: [c.name, c.email, c.phone, c.billing_address, c.notes].filter(Boolean).join("\n"),
      url: `${SITE_ORIGIN}/customers/${c.id}`,
      properties: {
        customerName: c.name ?? "",
        phone: c.phone ?? "",
        email: c.email ?? "",
        address: c.billing_address ?? "",
      },
    });
    if (ok) pushed++;
    else failed++;
  }

  console.log("Jobs...");
  const { data: jobs, error: jobErr } = await supabase
    .from("jobs")
    .select("id,status,scheduled_at,notes,customers(name),properties(address)");
  if (jobErr) throw new Error(jobErr.message);
  for (const j of jobs) {
    const title = [j.customers?.name, j.properties?.address].filter(Boolean).join(" — ") || "Job";
    const ok = await pushItem(token, {
      type: "job",
      id: j.id,
      title,
      content: [title, `Status: ${j.status}`, j.notes].filter(Boolean).join("\n"),
      url: `${SITE_ORIGIN}/jobs`,
      properties: {
        status: j.status ?? "",
        customerName: j.customers?.name ?? "",
        address: j.properties?.address ?? "",
        scheduledAt: j.scheduled_at ?? null,
      },
    });
    if (ok) pushed++;
    else failed++;
  }

  console.log("Documents...");
  const { data: docs, error: docErr } = await supabase
    .from("documents")
    .select("id,doc_number,type,status,total,customers(name),properties(address)");
  if (docErr) throw new Error(docErr.message);
  for (const d of docs) {
    const title = `${d.doc_number ?? d.type} — ${d.customers?.name ?? "Unknown customer"}`;
    const ok = await pushItem(token, {
      type: "document",
      id: d.id,
      title,
      content: [title, d.properties?.address, d.status ? `Status: ${d.status}` : null].filter(Boolean).join("\n"),
      url: `${SITE_ORIGIN}/documents/${d.id}`,
      properties: {
        docType: d.type ?? "",
        status: d.status ?? "",
        customerName: d.customers?.name ?? "",
        address: d.properties?.address ?? "",
        total: d.total ?? null,
      },
    });
    if (ok) pushed++;
    else failed++;
  }

  console.log(`\nDone. ${pushed} items pushed, ${failed} failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
