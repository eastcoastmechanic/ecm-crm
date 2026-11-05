// Link to the Teams "Job Notes" channel Files tab, where the job folders live
// (named by address). Not a secret: it is a channel link, sign-in still applies.
const DEFAULT_JOB_FILES_URL =
  "https://teams.microsoft.com/l/entity/0d820ecd-def2-4297-adad-78056cde7c78/_djb2_msteams_prefix_3999058376?context=%7B%22channelId%22%3A%2219%3A5ab18c1519df4165b00f33c904638491%40thread.tacv2%22%7D&tenantId=07668a60-a1da-4b87-ba71-fbae43225af3";

/** Set TEAMS_JOB_FILES_URL to override, or to "off" to hide the button. */
export function jobFilesUrl(): string | null {
  const v = process.env.TEAMS_JOB_FILES_URL?.trim();
  if (v === "off") return null;
  return v || DEFAULT_JOB_FILES_URL;
}
