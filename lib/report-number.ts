/**
 * Next service report number (RPT-1001, RPT-1002, ...) from the numbers already
 * used: the highest existing RPT number plus one. Counting rows instead would
 * hand out a number that is still in use once an older report is deleted.
 * Pure, so it is easy to test.
 */
export function nextReportNumberFrom(existing: (string | null | undefined)[]): string {
  let max = 1000;
  for (const value of existing) {
    const match = /^RPT-(\d+)$/.exec((value ?? "").trim());
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isSafeInteger(n) && n > max) max = n;
  }
  return `RPT-${max + 1}`;
}
