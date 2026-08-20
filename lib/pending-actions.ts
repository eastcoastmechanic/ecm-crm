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

export type ActionExecutor = (input: unknown) => Promise<string>;

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

  let result: string;
  try {
    result = await executor(pending.tool_input);
  } catch (err) {
    return `Execution failed: ${err instanceof Error ? err.message : "unknown error"}. Nothing was changed — you can try confirming again.`;
  }

  await supabase
    .from("pending_actions")
    .update({ consumed_at: new Date().toISOString(), result })
    .eq("id", token);

  return result;
}
