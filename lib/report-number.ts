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

export type ReportNumberResult = { reportNumber: string; error?: undefined } | { reportNumber?: undefined; error: string };

type RpcError = { code?: string | null; message?: string | null } | null;
type RpcResult = { data: unknown; error: RpcError };

/**
 * Next service report number.
 *
 * After SQL 0072 the database function next_report_number() hands it out under
 * a row lock on the RPT counter, so two reports started at the same moment get
 * different numbers. Until 0072 is run that function is missing, and we fall
 * back to the highest RPT number in use plus one (the #178 rule).
 *
 * The database calls are passed in, so the rule is easy to test.
 */
export async function allocateReportNumberWith(deps: {
  rpc: () => PromiseLike<RpcResult>;
  loadExisting: () => Promise<(string | null | undefined)[]>;
  isMissingFunction: (error: RpcError) => boolean;
}): Promise<ReportNumberResult> {
  const { data, error } = await deps.rpc();
  if (!error) {
    if (typeof data === "string" && /^RPT-\d+$/.test(data)) return { reportNumber: data };
    return { error: "Could not get a report number: the database returned nothing." };
  }
  if (!deps.isMissingFunction(error)) {
    return { error: `Could not get a report number: ${error.message ?? "unknown error"}` };
  }
  try {
    return { reportNumber: nextReportNumberFrom(await deps.loadExisting()) };
  } catch (err) {
    return { error: `Could not get a report number: ${err instanceof Error ? err.message : "unknown error"}` };
  }
}
