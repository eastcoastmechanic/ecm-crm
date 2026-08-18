// One-time setup: creates a second Planner plan, "ECM HQ", in the same
// "East Coast Mechanical Jobs" group the Jobs plan already lives in (see
// planner-setup.mjs) -- reuses the group instead of creating a new one, since
// a group can own more than one plan and this one doesn't need its own Team.
//
// This is the human-facing board from the ECM Operations Blueprint
// (2026-08-17): Today / Recurring / CRM Dev / Personal. It's deliberately
// separate from the Jobs plan, which the CRM's code writes to directly via
// exact bucket IDs (lib/planner-connector.ts) -- nothing here is wired to
// app code, so it's safe to rename/reorder by hand in the Planner UI later
// without breaking anything.
//
//   node scripts/planner-hq-setup.mjs
//
// Requires the same Group.ReadWrite.All / Tasks.ReadWrite.All permissions
// planner-setup.mjs already needed -- no new admin consent if that one's
// already been run.
//
// Prints the resulting IDs at the end. They're not read by any app code
// today, so saving them anywhere is optional -- useful only if a future
// script wants to write into this plan too.
import { loadEnvLocal, getGraphToken, graphFetch } from "./graph-connector-lib.mjs";

loadEnvLocal();

const GROUP_NAME = "East Coast Mechanical Jobs";
const PLAN_TITLE = "ECM HQ";
const BUCKETS = ["Today", "Recurring", "CRM Dev", "Personal"];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function findGroup(token) {
  const res = await graphFetch(
    token,
    `/groups?$filter=${encodeURIComponent(`displayName eq '${GROUP_NAME}'`)}`
  );
  if (!res.ok) throw new Error(`Group lookup failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.value[0] ?? null;
}

async function findPlanByTitle(token, groupId, title) {
  const res = await graphFetch(token, `/groups/${groupId}/planner/plans`);
  if (!res.ok) throw new Error(`Plan lookup failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.value.find((p) => p.title === title) ?? null;
}

async function createPlan(token, groupId, title) {
  const res = await graphFetch(token, "/planner/plans", {
    method: "POST",
    body: JSON.stringify({ owner: groupId, title }),
  });
  if (!res.ok) throw new Error(`Plan creation failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function findBuckets(token, planId) {
  const res = await graphFetch(token, `/planner/plans/${planId}/buckets`);
  if (!res.ok) throw new Error(`Bucket lookup failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.value;
}

async function createBucket(token, planId, name, afterOrderHint) {
  const res = await graphFetch(token, "/planner/buckets", {
    method: "POST",
    body: JSON.stringify({
      name,
      planId,
      orderHint: afterOrderHint ? `${afterOrderHint} !` : " !",
    }),
  });
  if (!res.ok) throw new Error(`Bucket creation failed for "${name}": ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const token = await getGraphToken();

  const group = await findGroup(token);
  if (!group) {
    throw new Error(`Group "${GROUP_NAME}" not found -- run scripts/planner-setup.mjs first.`);
  }
  console.log(`Using existing group "${GROUP_NAME}" (${group.id}).`);

  let plan = await findPlanByTitle(token, group.id, PLAN_TITLE);
  if (plan) {
    console.log(`Plan "${plan.title}" already exists (${plan.id}).`);
  } else {
    plan = await createPlan(token, group.id, PLAN_TITLE);
    console.log(`Created plan "${plan.title}" (${plan.id}).`);
    // Same propagation delay note as planner-setup.mjs -- a brand-new plan
    // can 404 on an immediate bucket create.
    await sleep(5_000);
  }

  const existingBuckets = await findBuckets(token, plan.id);
  const bucketIds = {};
  let lastOrderHint = null;
  for (const name of BUCKETS) {
    const existing = existingBuckets.find((b) => b.name === name);
    if (existing) {
      console.log(`Bucket "${name}" already exists (${existing.id}).`);
      bucketIds[name] = existing.id;
      lastOrderHint = existing.orderHint;
      continue;
    }
    const created = await createBucket(token, plan.id, name, lastOrderHint);
    console.log(`Created bucket "${name}" (${created.id}).`);
    bucketIds[name] = created.id;
    lastOrderHint = created.orderHint;
  }

  console.log(`\nDone. "${PLAN_TITLE}" plan id: ${plan.id}`);
  console.log("Bucket ids (not read by any app code -- for reference only):");
  for (const name of BUCKETS) {
    console.log(`  ${name}: ${bucketIds[name]}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
