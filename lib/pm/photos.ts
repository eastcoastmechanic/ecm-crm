import { supabase } from "@/lib/supabase";

export const PM_PHOTO_BUCKET = "pm-photos";
export const NAMEPLATE_PHOTO_BUCKET = "nameplate-photos";

export async function uploadPrivatePhoto(bucket: string, file: File, folder: string): Promise<string> {
  const type = file.type || "image/jpeg";
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: type });
  if (error) throw new Error(`Could not store the photo: ${error.message}`);
  return path;
}
