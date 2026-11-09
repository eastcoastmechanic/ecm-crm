import { supabase } from "@/lib/supabase";

/**
 * Generic draft-then-confirm mechanics for the MCP connector's risky
 * actions (delete, send, charge). Knows nothing about which actions exist —
 * just the DB bookkeeping — so the registry of what a confirm actually does
 * can't drift out of sync with what this file thinks is possible.
 */

const DEFAULT_TTL_MINUTES = 10;

export async function createPendingAction(
  actionName: string,
  input: unknown,
  preview: string,
  ttlMinutes = DEFAULT_TTL_MINUTES
): Promise<{ token: string; preview: string; expiresInMinutes: number }> {
  const { data, error } = await supabase
    .from("pending_actions")
    .insert({
      action_name: actionName,
      tool_input: input,
      preview,
      expires_at: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  return { token: data.id, preview, expiresInMinutes: ttlMinutes };
}

/**
 * `token` is the confirmation token being run. It is the same on a retry after
 * a failed run, so an executor can use it as an idempotency key (card charges).
 */
export type ActionExecutor = (input: unknown, ctx: { token: string }) => Promise<string>;

export async function confirmPendingAction(
  token: string,
  executors: Record<string, ActionExecutor>
): Promise<string> {
  const { data: pending, error } = await supabase
    .from("pending_actions")
    .select("action_name, tool_input, consumed_at, expires_at")
    .eq("id", token)
    .single();
  if (error || !pending) {
    return "No pending action found for that token — it may be invalid, or already expired.";
  }
  if (pending.consumed_at) {
    return "This action was already executed. Propose it again if you need to repeat it.";
  }
  if (new Date(pending.expires_at) < new Date()) {
    return "This confirmation token has expired. Propose the action again to get a new one.";
  }

  const executor = executors[pending.action_name];
  if (!executor) {
    return `No executor registered for "${pending.action_name}" — this is a bug, tell Josh.`;
  }

  // Claim the token BEFORE running anything. The read above is only for the
  // friendly messages: two confirms can both pass it, and a delete, send or card
  // charge must not run twice. The conditional update lets exactly one caller
  // through; the other sees no row come back.
  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("pending_actions")
    .update({ consumed_at: claimedAt })
    .eq("id", token)
    .is("consumed_at", null)
    .gt("expires_at", claimedAt)
    .select("id")
    .maybeSingle();
  if (claimError) {
    return `Could not confirm: ${claimError.message}. Nothing was changed — you can try again.`;
  }
  if (!claimed) {
    return "This action was already executed, or is running right now. Propose it again if you need to repeat it.";
  }

  let result: string;
  try {
    result = await executor(pending.tool_input, { token });
  } catch (err) {
    // Give the token back so a failed run can be retried.
    const { error: releaseError } = await supabase
      .from("pending_actions")
      .update({ consumed_at: null })
      .eq("id", token);
    const note = releaseError ? " The token could not be released, so propose the action again." : " You can try confirming again.";
    return `Execution failed: ${err instanceof Error ? err.message : "unknown error"}. It may not have completed.${note}`;
  }

  await supabase.from("pending_actions").update({ result }).eq("id", token);

  return result;
}
