// Deletes the external connection and waits for the deletion to actually
// finish (it's async on Microsoft's side -- the DELETE call returns 202
// immediately, but the connection keeps existing for a bit after).
//
// Needed because Graph rejects schema changes on an existing connection
// ("UpdateNotAllowed") -- delete + recreate (graph-connector-setup.mjs) is
// the only path Microsoft supports for adding properties after the fact.
// Re-run graph-connector-backfill's caller (the /api/admin/graph-backfill
// route) afterward -- deleting the connection deletes every indexed item
// with it.
import { loadEnvLocal, getGraphToken, graphFetch, CONNECTION_ID } from "./graph-connector-lib.mjs";

loadEnvLocal();

async function main() {
  const token = await getGraphToken();

  const del = await graphFetch(token, `/external/connections/${CONNECTION_ID}`, { method: "DELETE" });
  if (del.status !== 202 && del.status !== 404) {
    throw new Error(`Delete failed: ${del.status} ${await del.text()}`);
  }

  for (let i = 0; i < 30; i++) {
    const res = await graphFetch(token, `/external/connections/${CONNECTION_ID}`);
    if (res.status === 404) {
      console.log("Connection deleted.");
      return;
    }
    console.log(`Still exists (status ${res.status}), waiting...`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error("Gave up waiting for deletion.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
