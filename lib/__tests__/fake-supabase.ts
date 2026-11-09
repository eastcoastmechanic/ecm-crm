// A tiny stand-in for the Supabase query builder, for tests. Every call on a
// chain is recorded; when the chain is awaited (or ends in single/maybeSingle)
// the test's handler decides the result from the table and the recorded calls.

export type Op = [string, ...unknown[]];
export type Call = { table: string; ops: Op[]; end: "then" | "single" | "maybeSingle" };
export type Handler = (call: Call) => { data?: unknown; error?: { message: string; code?: string } | null };

const METHODS = ["select", "insert", "update", "delete", "eq", "neq", "is", "in", "not", "or", "order", "limit", "gte", "lt", "lte"];

export function fakeSupabase(handler: Handler) {
  const calls: Call[] = [];
  const run = (table: string, ops: Op[], end: Call["end"]) => {
    const call = { table, ops, end };
    calls.push(call);
    const result = handler(call);
    return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  };
  const client = {
    from(table: string) {
      const ops: Op[] = [];
      const chain: Record<string, unknown> = {};
      for (const m of METHODS) {
        chain[m] = (...args: unknown[]) => {
          ops.push([m, ...args]);
          return chain;
        };
      }
      chain.single = () => run(table, ops, "single");
      chain.maybeSingle = () => run(table, ops, "maybeSingle");
      chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        run(table, ops, "then").then(resolve, reject);
      return chain;
    },
  };
  return { client, calls };
}

/** True when the call used this method (and, if given, these leading arguments). */
export function has(call: Call, method: string, ...args: unknown[]): boolean {
  return call.ops.some(([m, ...a]) => m === method && args.every((arg, i) => a[i] === arg));
}

/** The argument passed to update/insert on this call, if any. */
export function payload(call: Call, method: "update" | "insert"): Record<string, unknown> | undefined {
  return call.ops.find(([m]) => m === method)?.[1] as Record<string, unknown> | undefined;
}
