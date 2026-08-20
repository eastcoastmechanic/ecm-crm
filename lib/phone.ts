// Customer phone numbers are stored as free-text (e.g. "(774) 555-1234"), but
// SMS providers require E.164. Assumes US/+1 since the business only serves
// the Plymouth, MA area.
export function toE164(raw: string) {
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw;
}
