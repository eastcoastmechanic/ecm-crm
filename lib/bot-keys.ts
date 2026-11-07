import { supabase } from "@/lib/supabase";
import { bearerToken, tokenMatches } from "@/lib/bearer-auth";
import { generateOpaqueToken, hashToken } from "@/lib/oauth";

/**
 * One key per bot (Grok bots, other outside agents). Only the SHA-256 hash is
 * stored (table bot_keys, SQL 0068); the key itself is shown once on /account.
 * A bot key names its caller, so a bot can't post as another bot.
 */

export const BOT_KEY_PREFIX = "ecmbot_";
export const BOT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** Who called the Field Board API. `bot` is null for the old shared keys. */
export type FieldBoardCaller = { bot: string | null };

/** The old shared Field Board keys. Checks every secret (no early exit) so timing doesn't show which matched. */
export function sharedFieldBoardKeyMatches(token: string): boolean {
  const secrets = [process.env.FIELD_BOARD_SECRET, process.env.FIELD_BOARD_APP_KEY];
  return secrets.reduce((ok, secret) => tokenMatches(token, secret) || ok, false);
}

type LiveKeyLookup = (tokenHash: string) => Promise<{ id: string; name: string } | null>;

/** Live (not revoked) key with this hash. Any error, including 0068 not run yet, means no match. */
const lookupLiveKey: LiveKeyLookup = async (tokenHash) => {
  const { data, error } = await supabase
    .from("bot_keys")
    .select("id, name")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();
  if (error || !data) return null;
  // Best effort: a failed stamp must not lock the bot out.
  await supabase.from("bot_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data;
};

/**
 * Field Board API auth: the old shared keys (bot = null) or one bot's key
 * (bot = its name). Returns null when neither matches. Fails closed.
 */
export async function fieldBoardCaller(
  request: Request,
  lookup: LiveKeyLookup = lookupLiveKey
): Promise<FieldBoardCaller | null> {
  const token = bearerToken(request);
  if (!token) return null;
  if (sharedFieldBoardKeyMatches(token)) return { bot: null };
  if (!token.startsWith(BOT_KEY_PREFIX)) return null;
  const row = await lookup(hashToken(token));
  return row ? { bot: row.name } : null;
}

/** A new key for a bot: the plain key (show once), its hash (store) and a hint (last 4). */
export function newBotKey() {
  const key = `${BOT_KEY_PREFIX}${generateOpaqueToken()}`;
  return { key, hash: hashToken(key), hint: key.slice(-4) };
}
