// One-time setup: creates the "East Coast Mechanical Jobs" Microsoft 365
// group, teamifies it, creates its Planner plan, and creates the 6 buckets
// the CRM's task tools expect. Safe to re-run -- reuses the group/plan/
// buckets if they already exist instead of creating duplicates.
//
//   node scripts/planner-setup.mjs
//
// Requires Group.ReadWrite.All, Team.Create, and Tasks.ReadWrite.All
// (application permissions) added to the same app registration the search
// connector uses, admin-consented in the Entra admin center -- the
// connector's ExternalConnection.* permissions don't cover this.
//
// Prints the resulting IDs at the end. Paste them into .env.local and
// Vercel's environment variables as MS_PLANNER_PLAN_ID and
// MS_PLANNER_BUCKET_*_ID.
import { loadEnvLocal, getGraphToken, graphFetch } from "./graph-connector-lib.mjs";

loadEnvLocal();

const GROUP_NAME = "East Coast Mechanical Jobs";
const PLAN_TITLE = "Jobs";
const BUCKETS = ["Tasks", "Jobs", "In Progress", "Needs Attention", "Finished", "Billed"];

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

async function createGroup(token) {
  const res = await graphFetch(token, "/groups", {
    method: "POST",
    body: JSON.stringify({
      displayName: GROUP_NAME,
      mailNickname: "ecmjobs",
      mailEnabled: true,
      securityEnabled: false,
      groupTypes: ["Unified"],
      description: "Job/task tracking for East Coast Mechanical -- created by Copilot, tracked in Planner.",
    }),
  });
  if (!res.ok) throw new Error(`Group creation failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function teamifyGroup(token, groupId) {
  const res = await graphFetch(token, `/groups/${groupId}/team`, {
    method: "PUT",
    body: JSON.stringify({}),
  });
  if (res.status === 201 || res.status === 200) {
    console.log("Teamified group (Teams enabled).");
    return;
  }
  if (res.status === 202) {
    console.log("Teams provisioning started (async) -- not waiting on it, Planner doesn't need it to finish.");
    return;
  }
  const body = await res.text();
  // Non-fatal: Planner works off the group regardless of whether Teams
  // chat/channels ever finish provisioning on top of it.
  console.warn(`Teamify skipped (non-fatal): ${res.status} ${body}`);
}

async function findPlan(token, groupId) {
  const res = await graphFetch(token, `/groups/${groupId}/planner/plans`);
  if (!res.ok) throw new Error(`Plan lookup failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.value[0] ?? null;
}

async function createPlan(token, groupId) {
  // A group that was just created can take a few seconds to propagate
  // before Planner will accept it as an owner -- retry through the initial
  // 400s instead of failing outright.
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await graphFetch(token, "/planner/plans", {
      method: "POST",
      body: JSON.stringify({ owner: groupId, title: PLAN_TITLE }),
    });
    if (res.ok) return res.json();
    if (attempt === 5) throw new Error(`Plan creation failed: ${res.status} ${await res.text()}`);
    console.log(`  plan creation not ready yet, retrying in 10s (attempt ${attempt + 1}/6)...`);
    await sleep(10_000);
  }
}

async function findBuckets(token, planId) {
  const res = await graphFetch(token, `/planner/plans/${planId}/buckets`);
  if (!res.ok) throw new Error(`Bucket lookup failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.value;
}

async function createBucket(token, planId, name, afterOrderHint) {
  // Planner's orderHint algorithm is intricate; appending " !" after the
  // previous bucket's actual assigned hint is the documented trick for
  // "put this one next" and is good enough here -- if the order ends up
  // slightly off it's purely cosmetic and a 2-second drag-to-reorder fix
  // in the Planner UI.
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

  let group = await findGroup(token);
  if (group) {
    console.log(`Group "${GROUP_NAME}" already exists (${group.id}).`);
  } else {
    group = await createGroup(token);
    console.log(`Created group "${GROUP_NAME}" (${group.id}).`);
    console.log("Waiting 15s for group propagation before teamifying/creating the plan...");
    await sleep(15_000);
  }

  await teamifyGroup(token, group.id);

  let plan = await findPlan(token, group.id);
  if (plan) {
    console.log(`Plan "${plan.title}" already exists (${plan.id}).`);
  } else {
    plan = await createPlan(token, group.id);
    console.log(`Created plan "${plan.title}" (${plan.id}).`);
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

  const envKeyByBucket = {
    Tasks: "MS_PLANNER_BUCKET_TASKS_ID",
    Jobs: "MS_PLANNER_BUCKET_JOBS_ID",
    "In Progress": "MS_PLANNER_BUCKET_IN_PROGRESS_ID",
    "Needs Attention": "MS_PLANNER_BUCKET_NEEDS_ATTENTION_ID",
    Finished: "MS_PLANNER_BUCKET_FINISHED_ID",
    Billed: "MS_PLANNER_BUCKET_BILLED_ID",
  };

  console.log("\nDone. Add these to .env.local and Vercel's environment variables:\n");
  console.log(`MS_PLANNER_GROUP_ID=${group.id}`);
  console.log(`MS_PLANNER_PLAN_ID=${plan.id}`);
  for (const name of BUCKETS) {
    console.log(`${envKeyByBucket[name]}=${bucketIds[name]}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
