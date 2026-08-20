import { z } from "zod";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { buildMcpTools } from "@/lib/internal-assistant/tools-mcp";

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
  if (!bearerToken || bearerToken !== process.env.MCP_API_KEY) return undefined;
  return { token: bearerToken, clientId: "josh", scopes: [] };
};

const authHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
