import { z } from "zod";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { buildMcpTools } from "@/lib/internal-assistant/tools-mcp";
import { supabase } from "@/lib/supabase";
import { hashToken } from "@/lib/oauth";

/**
 * The MCP endpoint Josh's own Claude client connects to directly -- a third
 * adapter over the same buildInternalTools()/betaZodTool registry the
 * internal chat assistant and the Copilot Studio bridge already use (see
 * lib/copilot-actions.ts for the precedent). No business logic lives here.
 *
 * betaZodTool's returned object doesn't re-expose the original Zod schema
 * (only .parse/.run/.name/.description), so each tool is registered with a
 * generic passthrough inputSchema and real validation happens via
 * tool.parse() inside the callback -- same parse-then-run shape
 * app/api/copilot-actions/[action]/route.ts already uses, just wrapped in
 * the MCP SDK's calling convention instead of one-route-per-action.
 */
export const maxDuration = 60;

const passthroughInput = z.record(z.string(), z.unknown());

const handler = createMcpHandler(
  (server) => {
    for (const tool of buildMcpTools()) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: passthroughInput },
        async (rawArgs) => {
          let input: unknown;
          try {
            input = tool.parse(rawArgs);
          } catch (err) {
            return {
              content: [{ type: "text", text: `Invalid input: ${err instanceof Error ? err.message : "validation failed"}` }],
              isError: true,
            };
          }

          try {
            const result = await tool.run(input);
            const text = typeof result === "string" ? result : JSON.stringify(result);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Action failed: ${err instanceof Error ? err.message : "unknown error"}` }],
              isError: true,
            };
          }
        }
      );
    }
  },
  { serverInfo: { name: "ecm-crm", version: "1.0.0" } }
);

const verifyToken = async (_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
  if (!bearerToken) return undefined;

  // Static key kept as a fallback for direct/CLI callers (curl, `claude mcp
  // add --header`) that don't need the OAuth dance -- already verified
  // end-to-end in production; adding OAuth alongside it doesn't weaken it,
  // it's an independent secret.
  if (process.env.MCP_API_KEY && bearerToken === process.env.MCP_API_KEY) {
    return { token: bearerToken, clientId: "josh-static", scopes: [] };
  }

  const { data: row } = await supabase
    .from("oauth_tokens")
    .select("client_id, expires_at, revoked_at")
    .eq("token_hash", hashToken(bearerToken))
    .eq("token_type", "access")
    .maybeSingle();

  if (!row || row.revoked_at) return undefined;
  const expiresAtMs = new Date(row.expires_at).getTime();
  if (expiresAtMs < Date.now()) return undefined;

  // withMcpAuth compares expiresAt in epoch *seconds* (Date.now()/1e3,
  // confirmed by reading node_modules/mcp-handler/dist/index.js) — must not
  // pass milliseconds here.
  return { token: bearerToken, clientId: row.client_id, scopes: [], expiresAt: Math.floor(expiresAtMs / 1000) };
};

const authHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
