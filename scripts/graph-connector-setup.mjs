// One-time setup: registers the Microsoft Graph external connection and its
// schema that Microsoft 365 Copilot indexes CRM customers/jobs/documents
// into. Run once (safe to re-run — it no-ops if the connection already
// exists and re-submits the same schema).
//
//   node scripts/graph-connector-setup.mjs
//
// Requires MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET in
// .env.local, from the Azure AD app registration with
// ExternalConnection.ReadWrite.OwnedBy admin-consented.
import { loadEnvLocal, getGraphToken, graphFetch, CONNECTION_ID } from "./graph-connector-lib.mjs";

loadEnvLocal();

async function main() {
  const token = await getGraphToken();

  const existing = await graphFetch(token, `/external/connections/${CONNECTION_ID}`);
  if (existing.status === 404) {
    const createRes = await graphFetch(token, "/external/connections", {
      method: "POST",
      body: JSON.stringify({
        id: CONNECTION_ID,
        name: "East Coast Mechanical CRM",
        description: "Customers, jobs, and documents from the ECM CRM (eastcoastmechanical.org).",
      }),
    });
    if (!createRes.ok) throw new Error(`Create connection failed: ${createRes.status} ${await createRes.text()}`);
    console.log(`Created connection "${CONNECTION_ID}".`);
  } else if (existing.ok) {
    console.log(`Connection "${CONNECTION_ID}" already exists.`);
  } else {
    throw new Error(`Connection lookup failed: ${existing.status} ${await existing.text()}`);
  }

  const schemaRes = await graphFetch(token, `/external/connections/${CONNECTION_ID}/schema`, {
    method: "POST",
    body: JSON.stringify({
      baseType: "microsoft.graph.externalItem",
      properties: [
        { name: "itemType", type: "string", isQueryable: true, isRetrievable: true, isSearchable: true },
        { name: "title", type: "string", isQueryable: true, isRetrievable: true, isSearchable: true, labels: ["title"] },
        { name: "url", type: "string", isRetrievable: true, labels: ["url"] },
        { name: "status", type: "string", isQueryable: true, isRetrievable: true, isSearchable: true },
        { name: "customerName", type: "string", isQueryable: true, isRetrievable: true, isSearchable: true },
        { name: "phone", type: "string", isRetrievable: true, isSearchable: true },
        { name: "email", type: "string", isRetrievable: true, isSearchable: true },
        { name: "address", type: "string", isQueryable: true, isRetrievable: true, isSearchable: true },
        { name: "scheduledAt", type: "dateTime", isQueryable: true, isRetrievable: true },
        { name: "docType", type: "string", isQueryable: true, isRetrievable: true, isSearchable: true },
        { name: "total", type: "double", isQueryable: true, isRetrievable: true },
        { name: "category", type: "string", isQueryable: true, isRetrievable: true, isSearchable: true },
        { name: "tier", type: "string", isQueryable: true, isRetrievable: true, isSearchable: true },
        { name: "unitPrice", type: "double", isQueryable: true, isRetrievable: true },
        { name: "laborHours", type: "double", isQueryable: true, isRetrievable: true },
        { name: "source", type: "string", isQueryable: true, isRetrievable: true, isSearchable: true },
        { name: "channel", type: "string", isQueryable: true, isRetrievable: true, isSearchable: true },
        { name: "contactName", type: "string", isQueryable: true, isRetrievable: true, isSearchable: true },
        { name: "qtyOnHand", type: "double", isQueryable: true, isRetrievable: true },
        { name: "reorderThreshold", type: "double", isQueryable: true, isRetrievable: true },
        { name: "lowStock", type: "string", isQueryable: true, isRetrievable: true },
      ],
    }),
  });
  if (!schemaRes.ok && schemaRes.status !== 409) {
    throw new Error(`Schema registration failed: ${schemaRes.status} ${await schemaRes.text()}`);
  }

  // Schema registration runs asynchronously on Microsoft's side. Poll the
  // operation Graph hands back until it reports completed/failed instead of
  // just hoping it worked by the time the backfill script runs next.
  const opLocation = schemaRes.headers.get("location");
  if (opLocation) {
    const opPath = opLocation.replace("https://graph.microsoft.com/v1.0", "");
    process.stdout.write("Waiting for schema to finish provisioning");
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 10_000));
      const opRes = await graphFetch(token, opPath);
      const op = await opRes.json();
      if (op.status === "completed") {
        console.log("\nSchema ready.");
        break;
      }
      if (op.status === "failed") {
        throw new Error(`Schema provisioning failed: ${JSON.stringify(op.error)}`);
      }
      process.stdout.write(".");
    }
  } else {
    console.log("Schema submitted (already existed or provisioned synchronously).");
  }

  console.log("\nDone. Next: run `node scripts/graph-connector-backfill.mjs` to load existing records.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
