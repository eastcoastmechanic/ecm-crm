import { supabase } from "@/lib/supabase";
import { one } from "@/lib/appointment-reminder";
import { CONNECTION_ID, delegatedFetch } from "@/lib/microsoft-delegated";
import { jobsDriveId } from "@/lib/job-folders";
import { NO_ADDRESS_SECTION, noteHtml, pageHtml, sectionNameForAddress } from "@/lib/onenote-rules";

/**
 * Copies CRM job notes into one shared OneNote notebook ("ECM Jobs") in the
 * ecmjobs SharePoint site: a section per address, a page per job, each note
 * appended to the page. Runs as the owner's connected Microsoft account
 * (lib/microsoft-delegated.ts). The CRM stays the record: OneNote is a copy,
 * and nothing here throws or blocks saving a note.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://ecm-crm.vercel.app";

function notebookName(): string {
  return process.env.ONENOTE_NOTEBOOK_NAME?.trim() || "ECM Jobs";
}

/** OData string literal: single quotes doubled. */
function odata(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

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
    await call(`/sites/${site.id}/onenote/notebooks?$filter=displayName eq ${encodeURIComponent(odata(name))}&$select=id`),
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

async function findSection(ids: Ids, name: string): Promise<string | null> {
  const res = await call(
    `/sites/${ids.siteId}/onenote/notebooks/${ids.notebookId}/sections?$filter=displayName eq ${encodeURIComponent(odata(name))}&$select=id`
  );
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

type JobRow = {
  id: string;
  job_type: string | null;
  scheduled_at: string | null;
  created_at: string;
  property_id: string | null;
  onenote_page_id: string | null;
  onenote_page_url: string | null;
  customers: { name: string | null } | { name: string | null }[] | null;
  properties:
    | { address: string | null; onenote_section_id: string | null }
    | { address: string | null; onenote_section_id: string | null }[]
    | null;
};

async function pageFor(ids: Ids, job: JobRow): Promise<string> {
  if (job.onenote_page_id) return job.onenote_page_id;
  const property = one(job.properties);
  const sectionId = await sectionFor(ids, job.property_id, property?.address ?? null, property?.onenote_section_id ?? null);
  const html = pageHtml(
    {
      customerName: one(job.customers)?.name ?? null,
      jobType: job.job_type,
      address: property?.address ?? null,
      scheduledAt: job.scheduled_at,
      createdAt: job.created_at,
    },
    `${APP_URL}/jobs`
  );
  const created = await call(`/sites/${ids.siteId}/onenote/sections/${sectionId}/pages`, {
    method: "POST",
    headers: { "Content-Type": "text/html" },
    body: html,
  });
  const page = await okJson<{ id: string; links?: { oneNoteWebUrl?: { href?: string } } }>(created, "page create");

  // Only the first request to finish keeps its page; a racing second one deletes its own copy.
  const { data: won } = await supabase
    .from("jobs")
    .update({ onenote_page_id: page.id, onenote_page_url: page.links?.oneNoteWebUrl?.href ?? null })
    .eq("id", job.id)
    .is("onenote_page_id", null)
    .select("id");
  if (won && won.length > 0) return page.id;

  await call(`/sites/${ids.siteId}/onenote/pages/${page.id}`, { method: "DELETE" }).catch(() => null);
  const { data: winner } = await supabase.from("jobs").select("onenote_page_id").eq("id", job.id).single();
  return winner!.onenote_page_id as string;
}

/**
 * Append this job's not-yet-copied notes to its OneNote page (making the
 * section and page the first time). Notes are claimed before sending so two
 * runs never copy the same note twice; a failed send releases them for the
 * next run.
 */
export async function syncJobNotesToOneNote(jobId: string): Promise<void> {
  const { data: pending } = await supabase
    .from("job_notes")
    .select("id")
    .eq("job_id", jobId)
    .is("onenote_synced_at", null)
    .limit(1);
  if (!pending || pending.length === 0) return;

  let claimed: { id: string; body: string; author_name: string | null; created_at: string }[] = [];
  try {
    const ids = await notebookIds();
    const { data: job, error } = await supabase
      .from("jobs")
      .select(
        "id, job_type, scheduled_at, created_at, property_id, onenote_page_id, onenote_page_url, customers(name), properties(address, onenote_section_id)"
      )
      .eq("id", jobId)
      .single();
    if (error || !job) return;
    const pageId = await pageFor(ids, job as unknown as JobRow);

    const { data } = await supabase
      .from("job_notes")
      .update({ onenote_synced_at: new Date().toISOString() })
      .eq("job_id", jobId)
      .is("onenote_synced_at", null)
      .select("id, body, author_name, created_at");
    claimed = (data ?? []).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    if (claimed.length === 0) return;

    const res = await call(`/sites/${ids.siteId}/onenote/pages/${pageId}/content`, {
      method: "PATCH",
      body: JSON.stringify(
        claimed.map((n) => ({
          target: "body",
          action: "append",
          content: noteHtml({ authorName: n.author_name, createdAt: n.created_at, body: n.body }),
        }))
      ),
    });
    if (res.status === 404) {
      // Page deleted in OneNote: forget it so the next note makes a fresh one.
      await supabase.from("jobs").update({ onenote_page_id: null, onenote_page_url: null }).eq("id", jobId);
      throw new Error("page gone");
    }
    if (!res.ok) throw new Error(`page append: ${res.status}`);
  } catch (err) {
    if (claimed.length > 0) {
      await supabase
        .from("job_notes")
        .update({ onenote_synced_at: null })
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
