import { supabase } from "@/lib/supabase";
import { graphConfigured, graphFetch } from "@/lib/graph-auth";
import { folderNameForAddress } from "@/lib/job-folder-rules";
import { one } from "@/lib/appointment-reminder";

/**
 * One SharePoint folder per property address, in the ecmjobs site:
 *   Shared Documents / Job Notes / "<street> <town>"
 * (the same folders the Teams Job Notes channel Files tab shows).
 *
 * The first job at an address makes the folder; later jobs at the same address reuse it.
 * An existing folder with the same name is picked up, never duplicated or overwritten.
 * Nothing here throws: a SharePoint problem must never fail the job that triggered it.
 */

// Drive id of the ecmjobs "Shared Documents" library. Not a secret (it needs a token to use).
const DEFAULT_DRIVE_ID = "b!KrU7O_CAqEyz8z4_XapXMKYJ4aCbNDBEjMXF7JiHendt6H_Hg0SKTKCuQWwSfurL";

function driveId(): string {
  return process.env.SHAREPOINT_JOBS_DRIVE_ID?.trim() || DEFAULT_DRIVE_ID;
}

function parentFolder(): string {
  return (process.env.SHAREPOINT_JOBS_PARENT?.trim() || "Job Notes").replace(/^\/+|\/+$/g, "");
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export type FolderResult =
  | { ok: true; url: string; name: string }
  | { ok: false; reason: "no_property" | "no_address" | "not_configured" | "needs_migration" | "graph_error" };

type FolderProperty = { files_folder_url: string | null; address: string | null };
type DriveItem = { id?: string; webUrl?: string; name?: string };

async function getFolder(name: string): Promise<{ status: number; item: DriveItem | null }> {
  const res = await graphFetch(
    `/drives/${driveId()}/root:/${encodePath(`${parentFolder()}/${name}`)}?$select=id,webUrl,name`
  );
  if (!res.ok) return { status: res.status, item: null };
  return { status: res.status, item: (await res.json()) as DriveItem };
}

async function findOrCreateFolder(name: string): Promise<DriveItem> {
  const existing = await getFolder(name);
  if (existing.item?.webUrl) return existing.item;
  if (existing.status !== 404) throw new Error(`folder lookup failed: ${existing.status}`);

  const created = await graphFetch(`/drives/${driveId()}/root:/${encodePath(parentFolder())}:/children`, {
    method: "POST",
    body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
  });
  if (created.ok) return (await created.json()) as DriveItem;

  // 409: someone (or a second request) made it a moment ago. Use theirs.
  if (created.status === 409) {
    const again = await getFolder(name);
    if (again.item?.webUrl) return again.item;
  }
  throw new Error(`folder create failed: ${created.status}`);
}

/** Make sure the property's address has a folder, remember its link, and return it. */
export async function ensurePropertyFolder(propertyId: string | null | undefined): Promise<FolderResult> {
  if (!propertyId) return { ok: false, reason: "no_property" };
  try {
    const { data: property, error } = await supabase
      .from("properties")
      .select("id, address, files_folder_url")
      .eq("id", propertyId)
      .maybeSingle();
    if (error) {
      return { ok: false, reason: /files_folder/i.test(error.message) ? "needs_migration" : "graph_error" };
    }
    if (!property) return { ok: false, reason: "no_property" };

    const name = folderNameForAddress(property.address);
    if (!name) return { ok: false, reason: "no_address" };
    if (property.files_folder_url) return { ok: true, url: property.files_folder_url, name };
    if (!graphConfigured()) return { ok: false, reason: "not_configured" };

    const folder = await findOrCreateFolder(name);
    if (!folder.webUrl) return { ok: false, reason: "graph_error" };

    await supabase
      .from("properties")
      .update({ files_folder_url: folder.webUrl, files_folder_id: folder.id ?? null })
      .eq("id", propertyId)
      .is("files_folder_url", null);
    return { ok: true, url: folder.webUrl, name };
  } catch (err) {
    console.error("[job-folders] ensure failed:", err instanceof Error ? err.message : "error");
    return { ok: false, reason: "graph_error" };
  }
}

/** Same, starting from a job. Jobs with no property have no address to name a folder after. */
export async function ensureJobFolder(jobId: string): Promise<FolderResult> {
  try {
    const { data: job, error } = await supabase
      .from("jobs")
      .select("property_id, properties(files_folder_url, address)")
      .eq("id", jobId)
      .maybeSingle();
    if (error) {
      return { ok: false, reason: /files_folder/i.test(error.message) ? "needs_migration" : "graph_error" };
    }
    if (!job?.property_id) return { ok: false, reason: "no_property" };
    // Already linked: skip the second lookup. Status changes call this often.
    const property = one(job.properties as unknown as FolderProperty | FolderProperty[] | null);
    const name = folderNameForAddress(property?.address);
    if (property?.files_folder_url && name) return { ok: true, url: property.files_folder_url, name };
    return await ensurePropertyFolder(job.property_id);
  } catch {
    return { ok: false, reason: "graph_error" };
  }
}
