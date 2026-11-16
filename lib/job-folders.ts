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

export function jobsDriveId(): string {
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
    `/drives/${jobsDriveId()}/root:/${encodePath(`${parentFolder()}/${name}`)}?$select=id,webUrl,name`
  );
  if (!res.ok) return { status: res.status, item: null };
  return { status: res.status, item: (await res.json()) as DriveItem };
}

async function findOrCreateFolder(name: string): Promise<DriveItem> {
  const existing = await getFolder(name);
  if (existing.item?.webUrl) return existing.item;
  if (existing.status !== 404) throw new Error(`folder lookup failed: ${existing.status}`);

  const created = await graphFetch(`/drives/${jobsDriveId()}/root:/${encodePath(parentFolder())}:/children`, {
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

export type FolderUploadResult =
  | { ok: true; itemId: string | null; url: string | null }
  | { ok: false; reason: Exclude<FolderResult, { ok: true }>["reason"] | "upload_failed"; detail?: string };

type FolderTarget = { ok: true; prefix: string; itemBase: boolean } | Exclude<FolderResult, { ok: true }>;

/**
 * Where a job's folder is in the drive. By its item id when the CRM has it, so a folder renamed in
 * SharePoint still works; else by its path under Job Notes.
 */
async function jobFolderTarget(jobId: string): Promise<FolderTarget> {
  const folder = await ensureJobFolder(jobId);
  if (!folder.ok) return folder;
  if (!graphConfigured()) return { ok: false, reason: "not_configured" };
  const { data } = await supabase.from("jobs").select("properties(files_folder_id)").eq("id", jobId).maybeSingle();
  const prop = one((data?.properties ?? null) as unknown as { files_folder_id: string | null } | { files_folder_id: string | null }[] | null);
  const id = prop?.files_folder_id ?? null;
  if (id) return { ok: true, prefix: `/drives/${jobsDriveId()}/items/${encodeURIComponent(id)}:/`, itemBase: true };
  return { ok: true, prefix: `/drives/${jobsDriveId()}/root:/${encodePath(`${parentFolder()}/${folder.name}`)}/`, itemBase: false };
}

async function makeSubfolder(target: { prefix: string; itemBase: boolean }, sub: string): Promise<void> {
  // Parent "children" endpoint: items/{id}/children, or root:/<path>:/children.
  const parent = target.itemBase ? target.prefix.replace(/:\/$/, "/children") : `${target.prefix.replace(/\/$/, "")}:/children`;
  await graphFetch(parent, {
    method: "POST",
    body: JSON.stringify({ name: sub, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
  }).catch(() => null);
}

/**
 * Put one file in the job's property folder, at relativePath ("Photos/<name>.jpg"). The same path
 * is replaced on a retry, never duplicated. Nothing here throws: a SharePoint problem must never
 * fail the upload or job action that triggered it; the caller records the result and retries later.
 */
export async function uploadToJobFolder(
  jobId: string,
  relativePath: string,
  body: Blob | ArrayBuffer | string,
  contentType: string
): Promise<FolderUploadResult> {
  try {
    const target = await jobFolderTarget(jobId);
    if (!target.ok) return { ok: false, reason: target.reason };
    const url = `${target.prefix}${encodePath(relativePath)}:/content?@microsoft.graph.conflictBehavior=replace`;
    const put = () => graphFetch(url, { method: "PUT", headers: { "Content-Type": contentType || "application/octet-stream" }, body });
    let res = await put();
    // A missing subfolder (Photos, Receipts): make it once and try again.
    if (res.status === 404 && relativePath.includes("/")) {
      await makeSubfolder(target, relativePath.split("/")[0]);
      res = await put();
    }
    if (!res.ok) return { ok: false, reason: "upload_failed", detail: `SharePoint said ${res.status}` };
    const item = (await res.json().catch(() => ({}))) as DriveItem;
    return { ok: true, itemId: item.id ?? null, url: item.webUrl ?? null };
  } catch (err) {
    const detail = err instanceof Error && err.name === "TimeoutError" ? "SharePoint timed out" : "SharePoint error";
    console.error("[job-folders] upload failed:", detail);
    return { ok: false, reason: "upload_failed", detail };
  }
}

/** Remove a copied file from SharePoint by its item id. Best effort, never throws. */
export async function deleteFromJobsDrive(itemId: string | null | undefined): Promise<boolean> {
  if (!itemId || !graphConfigured()) return false;
  try {
    const res = await graphFetch(`/drives/${jobsDriveId()}/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}
