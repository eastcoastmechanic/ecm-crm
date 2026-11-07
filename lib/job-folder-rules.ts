/**
 * Folder name for a property address: "<street> <town>", the way the existing
 * folders in the ecmjobs Job Notes library are named ("17 Lisas Ln Pembroke").
 *
 * Addresses in the CRM are free text, sometimes "17 Lisas Ln, Pembroke, MA 02359",
 * sometimes "17 Lisas Ln, Pembroke". Drop the state and zip tail and the commas, and
 * strip characters SharePoint will not accept in a folder name. Returns null when
 * there is nothing usable, so the caller can skip instead of creating a junk folder.
 */
export function folderNameForAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  let s = address.trim();
  s = s.replace(/,?\s*[A-Z]{2}\s+\d{5}(-\d{4})?\s*$/, ""); // ", MA 02359"
  s = s.replace(/,?\s*(MA|Massachusetts)\s*$/i, ""); // trailing state with no zip
  s = s.replace(/,/g, " ");
  s = s.replace(/["*:<>?/\\|#%~&{}]/g, " ");
  s = s.replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  if (s.length < 3) return null;
  return s.slice(0, 120).trim();
}
