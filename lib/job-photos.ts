import { supabase } from "@/lib/supabase";
import { signStoredPhotos } from "@/lib/photo-urls";

/**
 * Job documentation photos.
 *
 * These are the inside of customers' houses, so they live in a private bucket
 * and are read through short-lived signed URLs rather than public links. That
 * is the only real difference from the diagnostic/document photo paths, and
 * it's the reason this logic is shared instead of copy-pasted: a second
 * implementation is how one of them quietly ends up public again.
 */

export const JOB_PHOTO_BUCKET = "job-photos";

export type JobPhotoPhase = "arrival" | "during" | "completion";

export const JOB_PHOTO_PHASES: JobPhotoPhase[] = ["arrival", "during", "completion"];

/**
 * Stored shape. Photos written before 0029 have only `url` (a public link into
 * diagnostic-photos) and no `path`; both forms have to keep working, so `path`
 * is what marks an entry as living in the private bucket.
 */
export type JobPhoto = {
  url: string | null;
  caption: string | null;
  path?: string;
  phase?: JobPhotoPhase;
  taken_at?: string;
};

/** What the UI gets: always something renderable in `url`. */
export type ResolvedJobPhoto = JobPhoto & { url: string | null };

export function isJobPhotoArray(value: unknown): value is JobPhoto[] {
  return Array.isArray(value);
}

/**
 * Upload to the private bucket. Returns entries ready to append to
 * jobs.photos — note there is no public URL to store, by design.
 */
export async function uploadJobPhotoFiles(
  files: (File | Blob)[],
  opts: { phase?: JobPhotoPhase; caption?: string | null } = {}
): Promise<JobPhoto[]> {
  const uploaded: JobPhoto[] = [];

  for (const file of files) {
    if (!file || file.size === 0) continue;

    const name = file instanceof File && file.name ? file.name : "photo.jpg";
    const path = `${crypto.randomUUID()}-${name}`;

    const { error } = await supabase.storage.from(JOB_PHOTO_BUCKET).upload(path, file, {
      contentType: file.type || "image/jpeg",
    });
    if (error) throw new Error(`Failed to upload photo: ${error.message}`);

    uploaded.push({
      url: null,
      path,
      caption: opts.caption ?? null,
      phase: opts.phase,
      taken_at: new Date().toISOString(),
    });
  }

  return uploaded;
}

/**
 * Turn stored entries into renderable ones.
 *
 * Delegates to the shared signer so job photos and every other photo in the
 * CRM resolve the same way — a second implementation is how one of them
 * quietly ends up public again. Entries written before the private bucket
 * carry a public URL and are re-signed from it, so they keep rendering once
 * their bucket is locked down too.
 */
export async function resolveJobPhotos(photos: unknown): Promise<ResolvedJobPhoto[]> {
  if (!isJobPhotoArray(photos) || photos.length === 0) return [];
  return signStoredPhotos(photos as ResolvedJobPhoto[], { defaultBucket: JOB_PHOTO_BUCKET });
}

/** Append to a job's photo array. Reads first because jsonb has no push. */
export async function appendJobPhotos(jobId: string, additions: JobPhoto[]): Promise<number> {
  if (additions.length === 0) return 0;

  const { data: job, error: fetchError } = await supabase
    .from("jobs")
    .select("photos")
    .eq("id", jobId)
    .single();
  if (fetchError) throw new Error(fetchError.message);

  const existing = isJobPhotoArray(job?.photos) ? job.photos : [];

  const { error } = await supabase
    .from("jobs")
    .update({ photos: [...existing, ...additions] })
    .eq("id", jobId);
  if (error) throw new Error(error.message);

  return additions.length;
}

/**
 * A job's photos, signed and ready to put in front of a customer.
 *
 * `during` shots are deliberately excluded by default: mid-repair photos are
 * for the file, not for the invoice. Arrival and completion are the pair that
 * tell the story — this is what it looked like, this is what you paid for.
 */
export async function customerFacingJobPhotos(
  jobId: string | null | undefined,
  opts: { includeDuring?: boolean } = {}
): Promise<ResolvedJobPhoto[]> {
  if (!jobId) return [];

  const { data: job } = await supabase.from("jobs").select("photos").eq("id", jobId).single();
  const photos = isJobPhotoArray(job?.photos) ? job.photos : [];
  if (photos.length === 0) return [];

  const wanted = photos.filter((p) => {
    if (opts.includeDuring) return true;
    // Entries from before phases existed have no phase; keep them, since the
    // tech chose to attach them and there's no signal to drop them on.
    return p.phase !== "during";
  });

  const resolved = await resolveJobPhotos(wanted);
  // Arrival first, then undated/legacy, then completion — reads as a sequence.
  const order: Record<string, number> = { arrival: 0, during: 1, completion: 2 };
  return resolved.sort((a, b) => (order[a.phase ?? ""] ?? 1) - (order[b.phase ?? ""] ?? 1));
}

/** The job whose photos belong on a document, if the document is linked to one. */
export async function jobIdForDocument(documentId: string): Promise<string | null> {
  const { data } = await supabase
    .from("jobs")
    .select("id")
    .eq("document_id", documentId)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/** Which phases a job already has on file — drives the completion prompts. */
export async function jobPhotoPhases(jobId: string): Promise<Set<JobPhotoPhase>> {
  const { data: job } = await supabase.from("jobs").select("photos").eq("id", jobId).single();
  const photos = isJobPhotoArray(job?.photos) ? job.photos : [];

  const phases = new Set<JobPhotoPhase>();
  for (const p of photos) {
    if (p?.phase && JOB_PHOTO_PHASES.includes(p.phase)) phases.add(p.phase);
  }
  return phases;
}
