/**
 * Shrink photos in the browser before they're posted.
 *
 * Vercel caps a serverless function's request body at 4.5 MB, and that cap is
 * the platform's — `serverActions.bodySizeLimit` in next.config cannot raise
 * it. A phone photo off a modern handset is 3-6 MB, so two of them on one
 * form exceed the limit, the body arrives truncated, and the multipart parser
 * fails with "Unexpected end of form" — an error that says nothing about size
 * and sends you looking in the wrong place.
 *
 * 1600px matches what the glasses app already sends and what the CRM's vision
 * extraction needs to read a serial number off a rating plate. Beyond that
 * you're paying upload time on a roof for pixels nothing reads.
 */

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

/** Files at or under this are already small enough to leave alone. */
const SKIP_BELOW_BYTES = 600 * 1024;

export async function downscaleImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= SKIP_BELOW_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file);

    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob || blob.size >= file.size) return file;

    // Re-extension to .jpg because the bytes are JPEG now regardless of what
    // came in — a HEIC named .heic holding JPEG data confuses the storage
    // content type later.
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    // Canvas or bitmap decode failed (exotic format, memory pressure). Send
    // the original and let the server decide — a too-big upload is a better
    // outcome than silently dropping the photo.
    return file;
  }
}

/**
 * Replace a file input's selection with downscaled copies, in place.
 *
 * Done on the input rather than by intercepting submit so plain Server Action
 * forms keep working untouched — the form posts whatever `input.files` holds
 * by the time it's submitted.
 */
export async function downscaleFileInput(input: HTMLInputElement): Promise<void> {
  const files = Array.from(input.files ?? []);
  if (files.length === 0) return;

  const shrunk = await Promise.all(files.map(downscaleImage));

  const transfer = new DataTransfer();
  for (const f of shrunk) transfer.items.add(f);
  input.files = transfer.files;
}

/** Human-readable total, for telling the tech why their upload was refused. */
export function totalBytes(input: HTMLInputElement | null): number {
  return Array.from(input?.files ?? []).reduce((sum, f) => sum + f.size, 0);
}
