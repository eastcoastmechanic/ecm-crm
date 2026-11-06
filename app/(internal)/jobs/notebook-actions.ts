"use server";

import { supabase } from "@/lib/supabase";
import { getMyStaffId, requireJobAccess } from "@/lib/job-access";
import { ensureJobFolder, type FolderResult } from "@/lib/job-folders";

// Notebook for one job: dated notes plus the SharePoint folder for the job's address.
// Open to a tech only for their own job (requireJobAccess). Nothing here touches money.

export type NotebookNote = { id: string; body: string; author_name: string | null; created_at: string };

export type NotebookState = {
  error?: string;
  notes: NotebookNote[];
  folderUrl: string | null;
  folderName: string | null;
  folderNote: string | null;
};

const FOLDER_NOTES: Record<string, string> = {
  no_property: "This job has no property yet, so there is no address to name a folder after.",
  no_address: "This property has no usable address for a folder name.",
  not_configured: "SharePoint is not connected here yet.",
  needs_migration: "Run db/migrations/0060_job_notebook.sql in Supabase to turn on job folders.",
  graph_error: "Could not reach the SharePoint folder. Notes still save here.",
};

const MIGRATION_MESSAGE = "Run db/migrations/0060_job_notebook.sql in Supabase to turn on the notebook.";
const MAX_NOTE_LENGTH = 4000;

function folderFields(folder: FolderResult) {
  return folder.ok
    ? { folderUrl: folder.url, folderName: folder.name, folderNote: null }
    : { folderUrl: null, folderName: null, folderNote: FOLDER_NOTES[folder.reason] ?? null };
}

const empty = (error: string): NotebookState => ({ error, notes: [], folderUrl: null, folderName: null, folderNote: null });

export async function loadJobNotebook(jobId: string): Promise<NotebookState> {
  try {
    await requireJobAccess(jobId, { allowClosedJob: true });
  } catch {
    return empty("Not allowed");
  }

  const [notesRes, folder] = await Promise.all([
    supabase
      .from("job_notes")
      .select("id, body, author_name, created_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(200),
    ensureJobFolder(jobId),
  ]);

  if (notesRes.error) {
    return { ...empty(/job_notes/i.test(notesRes.error.message) ? MIGRATION_MESSAGE : "Could not load notes."), ...folderFields(folder) };
  }
  return { notes: (notesRes.data ?? []) as NotebookNote[], ...folderFields(folder) };
}

export async function addJobNote(
  jobId: string,
  body: string
): Promise<{ error?: string; note?: NotebookNote }> {
  try {
    await requireJobAccess(jobId, { allowClosedJob: true });
  } catch {
    return { error: "Not allowed" };
  }

  const text = (body ?? "").trim();
  if (!text) return { error: "Write a note first." };
  if (text.length > MAX_NOTE_LENGTH) return { error: `Keep it under ${MAX_NOTE_LENGTH} characters.` };

  const staffId = await getMyStaffId();
  let authorName: string | null = null;
  if (staffId) {
    const { data: staff } = await supabase.from("staff").select("name").eq("id", staffId).maybeSingle();
    authorName = (staff?.name as string | null) ?? null;
  }

  const { data, error } = await supabase
    .from("job_notes")
    .insert({ job_id: jobId, author_staff_id: staffId, author_name: authorName ?? "Office", body: text })
    .select("id, body, author_name, created_at")
    .single();
  if (error || !data) {
    return { error: /job_notes/i.test(error?.message ?? "") ? MIGRATION_MESSAGE : "Could not save the note." };
  }
  return { note: data as NotebookNote };
}
