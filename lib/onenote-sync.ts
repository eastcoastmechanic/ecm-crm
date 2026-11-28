import { after } from "next/server";
import { supabase } from "@/lib/supabase";
import { one } from "@/lib/appointment-reminder";
import { CONNECTION_ID, delegatedFetch } from "@/lib/microsoft-delegated";
import { jobsDriveId } from "@/lib/job-folders";
import {
  JOB_NOTES_PAGE_TITLE,
  NO_ADDRESS_SECTION,
  altSectionGroupName,
  jobSectionName,
  noteHtml,
  pageHtml,
  sectionGroupNameForAddress,
  sectionNameForAddress,
} from "@/lib/onenote-rules";

/**
 * Copies CRM job notes into one shared OneNote notebook ("ECM Jobs") in the
 * ecmjobs SharePoint site. Runs as the owner's connected Microsoft account
 * (lib/microsoft-delegated.ts). The CRM stays the record: OneNote is a copy,
 * and nothing here throws or blocks saving a job or a note.
 *
 * Layout for new jobs (SQL 0086): a section group per address, a section per
 * job (made when the job is made), and a "Job notes" page in it that each note
 * is appended to. Jobs that already have a page (the older layout: a section
 * per address, a page per job) keep using that page. Before SQL 0086 runs,
 * every job uses the older layout, made at the first note, as before.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://ecm-crm.vercel.app";

function notebookName(): string {
  return process.env.ONENOTE_NOTEBOOK_NAME?.trim() || "ECM Jobs";
}

/** OData string literal: single quotes doubled. */
function odata(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const byName = (name: string) => `$filter=displayName eq ${encodeURIComponent(odata(name))}`;

class NotConnected extends Error {}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await delegatedFetch(path, init);
  if (!res) throw new NotConnected();
  return res;
}

async function okJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what}: ${res.status}`);
  return (await res.json()) as T;
}

type Ids = { siteId: string; notebookId: string };

/** The ecmjobs site and the ECM Jobs notebook in it (made once, then remembered on the connection row). */
async function notebookIds(): Promise<Ids> {
  const { data: row } = await supabase
    .from("microsoft_connections")
    .select("site_id, notebook_id")
    .eq("id", CONNECTION_ID)
    .maybeSingle();
  if (row?.site_id && row?.notebook_id) return { siteId: row.site_id as string, notebookId: row.notebook_id as string };

  // Site from the same document library the job folders use.
  const drive = await okJson<{ webUrl?: string }>(await call(`/drives/${jobsDriveId()}?$select=webUrl`), "drive lookup");
  const driveUrl = new URL(drive.webUrl ?? "");
  const sitePath = driveUrl.pathname.split("/").slice(0, 3).join("/"); // "/sites/ecmjobs"
  const site = await okJson<{ id: string }>(
    await call(`/sites/${driveUrl.hostname}:${sitePath}?$select=id`),
    "site lookup"
  );

  const name = notebookName();
  const found = await okJson<{ value: { id: string }[] }>(
    await call(`/sites/${site.id}/onenote/notebooks?${byName(name)}&$select=id`),
    "notebook lookup"
  );
  let notebookId = found.value[0]?.id;
  if (!notebookId) {
    const created = await call(`/sites/${site.id}/onenote/notebooks`, {
      method: "POST",
      body: JSON.stringify({ displayName: name }),
    });
    notebookId = (await okJson<{ id: string }>(created, "notebook create")).id;
  }

  await supabase
    .from("microsoft_connections")
    .update({ site_id: site.id, notebook_id: notebookId })
    .eq("id", CONNECTION_ID);
  return { siteId: site.id, notebookId };
}

// ---------------------------------------------------------------- older layout (section per address)

async function findSection(ids: Ids, name: string): Promise<string | null> {
  const res = await call(`/sites/${ids.siteId}/onenote/notebooks/${ids.notebookId}/sections?${byName(name)}&$select=id`);
  const json = await okJson<{ value: { id: string }[] }>(res, "section lookup");
  return json.value[0]?.id ?? null;
}

async function sectionFor(ids: Ids, propertyId: string | null, address: string | null, cached: string | null): Promise<string> {
  if (cached) return cached;
  const name = propertyId ? sectionNameForAddress(address) : NO_ADDRESS_SECTION;
  let sectionId = await findSection(ids, name);
  if (!sectionId) {
    const created = await call(`/sites/${ids.siteId}/onenote/notebooks/${ids.notebookId}/sections`, {
      method: "POST",
      body: JSON.stringify({ displayName: name }),
    });
    // 409: made a moment ago by another request. Use that one.
    sectionId = created.ok ? (await created.json()).id : created.status === 409 ? await findSection(ids, name) : null;
    if (!sectionId) throw new Error(`section create: ${created.status}`);
  }
  if (propertyId) {
    await supabase.from("properties").update({ onenote_section_id: sectionId }).eq("id", propertyId).is("onenote_section_id", null);
  }
  return sectionId;
}

// ---------------------------------------------------------------- new layout (group per address, section per job)

type PropertyRow = { address: string | null; onenote_section_id: string | null; onenote_section_group_id?: string | null };

type JobRow = {
  id: string;
  job_type: string | null;
  scheduled_at: string | null;
  created_at: string;
  property_id: string | null;
  onenote_page_id: string | null;
  onenote_page_url: string | null;
  onenote_section_id?: string | null;
  onenote_section_url?: string | null;
  customers: { name: string | null } | { name: string | null }[] | null;
  properties: PropertyRow | PropertyRow[] | null;
};

/** newLayout is false until SQL 0086 adds the section columns. */
type LoadedJob = { job: JobRow; newLayout: boolean };

const OLD_COLUMNS =
  "id, job_type, scheduled_at, created_at, property_id, onenote_page_id, onenote_page_url, customers(name), properties(address, onenote_section_id)";
const NEW_COLUMNS =
  "id, job_type, scheduled_at, created_at, property_id, onenote_page_id, onenote_page_url, onenote_section_id, onenote_section_url, customers(name), properties(address, onenote_section_id, onenote_section_group_id)";

async function loadJob(jobId: string): Promise<LoadedJob | null> {
  const res = await supabase.from("jobs").select(NEW_COLUMNS).eq("id", jobId).maybeSingle();
  if (!res.error) return res.data ? { job: res.data as unknown as JobRow, newLayout: true } : null;
  if (!/onenote_section/i.test(res.error.message)) throw new Error("job lookup failed");
  const old = await supabase.from("jobs").select(OLD_COLUMNS).eq("id", jobId).maybeSingle();
  if (old.error) throw new Error("job lookup failed");
  return old.data ? { job: old.data as unknown as JobRow, newLayout: false } : null;
}

async function findSectionGroup(ids: Ids, name: string): Promise<string | null> {
  const res = await call(
    `/sites/${ids.siteId}/onenote/notebooks/${ids.notebookId}/sectionGroups?${byName(name)}&$select=id`
  );
  const json = await okJson<{ value: { id: string }[] }>(res, "section group lookup");
  return json.value[0]?.id ?? null;
}

/** Find or make a group by name. Null when OneNote will not make it and none by that name exists. */
async function groupNamed(ids: Ids, name: string): Promise<string | null> {
  const found = await findSectionGroup(ids, name);
  if (found) return found;
  const created = await call(`/sites/${ids.siteId}/onenote/notebooks/${ids.notebookId}/sectionGroups`, {
    method: "POST",
    body: JSON.stringify({ displayName: name }),
  });
  if (created.ok) return ((await created.json()) as { id: string }).id;
  // Refused: either made a moment ago by another run (use it) or the name is taken by something else.
  return findSectionGroup(ids, name);
}

/** The address's section group, made the first time and remembered on the property. */
async function sectionGroupFor(ids: Ids, job: JobRow): Promise<string> {
  const property = one(job.properties);
  if (job.property_id && property?.onenote_section_group_id) return property.onenote_section_group_id;

  const name = job.property_id ? sectionGroupNameForAddress(property?.address) : NO_ADDRESS_SECTION;
  // An older per-address section can hold the plain name, so fall back to "<name> Jobs".
  const groupId = (await groupNamed(ids, name)) ?? (await groupNamed(ids, altSectionGroupName(name)));
  if (!groupId) throw new Error("section group create failed");

  if (job.property_id) {
    const { data: won } = await supabase
      .from("properties")
      .update({ onenote_section_group_id: groupId })
      .eq("id", job.property_id)
      .is("onenote_section_group_id", null)
      .select("id");
    if (!won || won.length === 0) {
      const { data: saved } = await supabase
        .from("properties")
        .select("onenote_section_group_id")
        .eq("id", job.property_id)
        .maybeSingle();
      return (saved?.onenote_section_group_id as string | null) ?? groupId;
    }
  }
  return groupId;
}

type SectionItem = { id: string; links?: { oneNoteWebUrl?: { href?: string } } };

async function findSectionInGroup(ids: Ids, groupId: string, name: string): Promise<SectionItem | null> {
  const res = await call(`/sites/${ids.siteId}/onenote/sectionGroups/${groupId}/sections?${byName(name)}`);
  if (res.status === 404) return null;
  const json = await okJson<{ value: SectionItem[] }>(res, "job section lookup");
  return json.value[0] ?? null;
}

/**
 * The job's own section, made the first time and saved on the job. Its name is fixed by the
 * job, and OneNote refuses a second section with the same name in a group, so two runs at
 * once end up on the same section (OneNote has no way to delete a section, so this matters).
 */
async function jobSectionFor(ids: Ids, job: JobRow): Promise<string> {
  if (job.onenote_section_id) return job.onenote_section_id;

  const groupId = await sectionGroupFor(ids, job);
  const name = jobSectionName({ id: job.id, jobType: job.job_type, scheduledAt: job.scheduled_at, createdAt: job.created_at });
  let section = await findSectionInGroup(ids, groupId, name);
  if (!section) {
    const created = await call(`/sites/${ids.siteId}/onenote/sectionGroups/${groupId}/sections`, {
      method: "POST",
      body: JSON.stringify({ displayName: name }),
    });
    if (created.status === 404 && job.property_id) {
      // Group deleted in OneNote: forget it so the next run makes a fresh one for this address.
      await supabase
        .from("properties")
        .update({ onenote_section_group_id: null })
        .eq("id", job.property_id)
        .eq("onenote_section_group_id", groupId);
      throw new Error("section group gone");
    }
    section = created.ok ? ((await created.json()) as SectionItem) : await findSectionInGroup(ids, groupId, name);
    if (!section) throw new Error(`job section create: ${created.status}`);
  }

  const { data: won } = await supabase
    .from("jobs")
    .update({ onenote_section_id: section.id, onenote_section_url: section.links?.oneNoteWebUrl?.href ?? null })
    .eq("id", job.id)
    .is("onenote_section_id", null)
    .select("id");
  if (won && won.length > 0) return section.id;
  const { data: saved } = await supabase.from("jobs").select("onenote_section_id").eq("id", job.id).maybeSingle();
  return (saved?.onenote_section_id as string | null) ?? section.id;
}

// ---------------------------------------------------------------- pages and notes

type ClaimedNote = { id: string; body: string; author_name: string | null; created_at: string };

const toPageNote = (n: ClaimedNote) => ({ authorName: n.author_name, createdAt: n.created_at, body: n.body });

/**
 * Make the job's page with these notes already on it (none is fine for a new job). Returns
 * false when another run saved a page for this job first: this run's copy is deleted and its
 * notes go onto the saved page next time.
 */
async function createPageWithNotes(ids: Ids, loaded: LoadedJob, notes: ClaimedNote[], retried = false): Promise<boolean> {
  const { job, newLayout } = loaded;
  const property = one(job.properties);
  const sectionId = newLayout
    ? await jobSectionFor(ids, job)
    : await sectionFor(ids, job.property_id, property?.address ?? null, property?.onenote_section_id ?? null);
  const html = pageHtml(
    {
      customerName: one(job.customers)?.name ?? null,
      jobType: job.job_type,
      address: property?.address ?? null,
      scheduledAt: job.scheduled_at,
      createdAt: job.created_at,
    },
    `${APP_URL}/jobs`,
    notes.map(toPageNote),
    newLayout ? JOB_NOTES_PAGE_TITLE : undefined
  );
  const created = await call(`/sites/${ids.siteId}/onenote/sections/${sectionId}/pages`, {
    method: "POST",
    headers: { "Content-Type": "text/html" },
    body: html,
  });
  if (created.status === 404) {
    // Section deleted in OneNote: forget it so the next run makes a fresh one.
    if (newLayout) {
      await supabase
        .from("jobs")
        .update({ onenote_section_id: null, onenote_section_url: null })
        .eq("id", job.id)
        .eq("onenote_section_id", sectionId);
      // The job's own section: make it again right away (once), so the job is not left without one.
      if (!retried) {
        return createPageWithNotes(ids, { job: { ...job, onenote_section_id: null, onenote_section_url: null }, newLayout }, notes, true);
      }
    } else if (job.property_id) {
      await supabase
        .from("properties")
        .update({ onenote_section_id: null })
        .eq("id", job.property_id)
        .eq("onenote_section_id", sectionId);
    }
    throw new Error("section gone");
  }
  const page = await okJson<{ id: string; links?: { oneNoteWebUrl?: { href?: string } } }>(created, "page create");

  // Only the first request to finish keeps its page; a racing second one deletes its own copy.
  const { data: won } = await supabase
    .from("jobs")
    .update({ onenote_page_id: page.id, onenote_page_url: page.links?.oneNoteWebUrl?.href ?? null })
    .eq("id", job.id)
    .is("onenote_page_id", null)
    .select("id");
  if (won && won.length > 0) return true;

  await call(`/sites/${ids.siteId}/onenote/pages/${page.id}`, { method: "DELETE" }).catch(() => null);
  return false;
}

/** True only when OneNote confirms the page no longer exists (not just "not ready yet"). */
async function pageIsGone(ids: Ids, pageId: string): Promise<boolean> {
  const res = await call(`/sites/${ids.siteId}/onenote/pages/${pageId}?$select=id`);
  return res.status === 404;
}

/** A claim older than this is treated as abandoned (the run that made it stopped) and retried. */
export const CLAIM_STALE_MINUTES = 10;

/**
 * Append this job's not-yet-copied notes to its OneNote page, and with makeIfMissing make the
 * job's section and page even when there is no note yet (new layout only). Notes are claimed
 * (onenote_claimed_at) before sending so two runs never copy the same note at once, and marked
 * copied (onenote_synced_at) only after OneNote accepts them. A failed send releases the claim;
 * a run that dies mid-way leaves a claim that goes stale after CLAIM_STALE_MINUTES and is picked
 * up again, so no note is lost.
 */
async function copyJobToOneNote(jobId: string, makeIfMissing: boolean): Promise<void> {
  let claimed: ClaimedNote[] = [];
  try {
    const staleBefore = new Date(Date.now() - CLAIM_STALE_MINUTES * 60_000).toISOString();
    const unclaimed = `onenote_claimed_at.is.null,onenote_claimed_at.lt.${staleBefore}`;
    const { data: pending } = await supabase
      .from("job_notes")
      .select("id")
      .eq("job_id", jobId)
      .is("onenote_synced_at", null)
      .or(unclaimed)
      .limit(1);
    const hasPending = !!pending && pending.length > 0;
    let ids: Ids | null = null;
    if (!hasPending) {
      if (!makeIfMissing) return;
      // Nothing to copy: only a new-layout job needs Microsoft at all.
      const first = await loadJob(jobId);
      if (!first || !first.newLayout) return;
      const pageId = first.job.onenote_page_id;
      if (pageId) {
        // Older-layout page (no job section): leave it alone.
        if (!first.job.onenote_section_id) return;
        // New-layout page: if it (or its section) was deleted in OneNote, forget it and make it
        // again below, so the job never keeps a dead link just because no note is waiting.
        ids = await notebookIds();
        if (!(await pageIsGone(ids, pageId))) return;
        await supabase
          .from("jobs")
          .update({ onenote_page_id: null, onenote_page_url: null })
          .eq("id", jobId)
          .eq("onenote_page_id", pageId);
      }
    }

    ids = ids ?? (await notebookIds());

    if (hasPending) {
      // Claim first: only a run holding notes (or making a new job's page) ever makes a page.
      const { data } = await supabase
        .from("job_notes")
        .update({ onenote_claimed_at: new Date().toISOString() })
        .eq("job_id", jobId)
        .is("onenote_synced_at", null)
        .or(unclaimed)
        .select("id, body, author_name, created_at");
      claimed = ((data ?? []) as ClaimedNote[]).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      if (claimed.length === 0 && !makeIfMissing) return;
    }

    const loaded = await loadJob(jobId);
    if (!loaded) throw new Error("job not found");

    if (!loaded.job.onenote_page_id) {
      // Before SQL 0086 a page is still made only with the first note, as before.
      if (claimed.length === 0 && !loaded.newLayout) return;
      // First copy for this job: the notes go in with the new page (no follow-up update to fail).
      if (!(await createPageWithNotes(ids, loaded, claimed))) {
        if (claimed.length > 0) throw new Error("another run made the page");
        return;
      }
    } else {
      if (claimed.length === 0) return;
      const pageId = loaded.job.onenote_page_id;
      const res = await call(`/sites/${ids.siteId}/onenote/pages/${pageId}/content`, {
        method: "PATCH",
        body: JSON.stringify(
          claimed.map((n) => ({ target: "body", action: "append", content: noteHtml(toPageNote(n)) }))
        ),
      });
      if (res.status === 404) {
        // A new page can say 404 for a few seconds. Only forget it when OneNote confirms it was deleted.
        if (await pageIsGone(ids, pageId)) {
          await supabase
            .from("jobs")
            .update({ onenote_page_id: null, onenote_page_url: null })
            .eq("id", jobId)
            .eq("onenote_page_id", pageId);
          throw new Error("page deleted in OneNote");
        }
        throw new Error("page not ready yet");
      }
      if (!res.ok) throw new Error(`page append: ${res.status}`);
    }

    if (claimed.length > 0) {
      await supabase
        .from("job_notes")
        .update({ onenote_synced_at: new Date().toISOString() })
        .in(
          "id",
          claimed.map((n) => n.id)
        );
    }
  } catch (err) {
    if (claimed.length > 0) {
      await supabase
        .from("job_notes")
        .update({ onenote_claimed_at: null })
        .is("onenote_synced_at", null)
        .in(
          "id",
          claimed.map((n) => n.id)
        );
    }
    if (!(err instanceof NotConnected)) {
      console.error("[onenote] sync failed:", err instanceof Error ? err.message : "error");
    }
  }
}

/** Copy any not-yet-copied notes to the job's page (making the page with the first note). Never throws. */
export function syncJobNotesToOneNote(jobId: string): Promise<void> {
  return copyJobToOneNote(jobId, false);
}

/**
 * Make sure a job has its OneNote section and "Job notes" page (new layout, after SQL 0086), and
 * copy any waiting notes. Jobs on an older page keep it. Quiet when OneNote is not connected.
 * Never throws.
 */
export function ensureJobOneNote(jobId: string): Promise<void> {
  return copyJobToOneNote(jobId, true);
}

/**
 * Run ensureJobOneNote after the response, so making a job never waits on Microsoft.
 * Call this right after a job is inserted. The Notebook catches up any job this misses.
 */
export function scheduleJobOneNote(jobId: string | null | undefined): void {
  if (!jobId) return;
  const run = () => ensureJobOneNote(jobId);
  try {
    after(run);
  } catch {
    // Outside a request (or inside another after()): just start it.
    void run().catch(() => undefined);
  }
}
