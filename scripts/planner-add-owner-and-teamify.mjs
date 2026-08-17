// One-time fix-up: the Planner setup group was created by the app's service
// principal, which Teams won't accept as an owner (Teams requires a real
// user). This adds Josh as an owner and retries provisioning Teams on the
// group. Safe to re-run.
//
//   node scripts/planner-add-owner-and-teamify.mjs
import { loadEnvLocal, getGraphToken, graphFetch } from "./graph-connector-lib.mjs";

loadEnvLocal();

const OWNER_UPN = "JoshCrowley@eastcoastmechanical.org";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const token = await getGraphToken();
  const groupId = process.env.MS_PLANNER_GROUP_ID;
  if (!groupId) throw new Error("MS_PLANNER_GROUP_ID not set -- run planner-setup.mjs first");

  const userRes = await graphFetch(token, `/users/${encodeURIComponent(OWNER_UPN)}`);
  if (!userRes.ok) throw new Error(`User lookup failed: ${userRes.status} ${await userRes.text()}`);
  const user = await userRes.json();
  console.log(`Found user ${OWNER_UPN} (${user.id}).`);

  const existingOwnersRes = await graphFetch(token, `/groups/${groupId}/owners`);
  const existingOwners = existingOwnersRes.ok ? (await existingOwnersRes.json()).value : [];
  if (existingOwners.some((o) => o.id === user.id)) {
    console.log("Already an owner.");
  } else {
    const addRes = await graphFetch(token, `/groups/${groupId}/owners/$ref`, {
      method: "POST",
      body: JSON.stringify({ "@odata.id": `https://graph.microsoft.com/v1.0/users/${user.id}` }),
    });
    if (!addRes.ok) throw new Error(`Add owner failed: ${addRes.status} ${await addRes.text()}`);
    console.log("Added as owner.");
  }

  console.log("Waiting 15s for owner propagation before retrying Teamify...");
  await sleep(15_000);

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await graphFetch(token, `/groups/${groupId}/team`, { method: "PUT", body: JSON.stringify({}) });
    if (res.status === 200 || res.status === 201 || res.status === 202) {
      console.log(`Teamify succeeded (${res.status}).`);
      return;
    }
    const body = await res.text();
    if (attempt === 3) throw new Error(`Teamify failed after retries: ${res.status} ${body}`);
    console.log(`  not ready yet (${res.status}), retrying in 10s (attempt ${attempt + 1}/4)...`);
    await sleep(10_000);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
