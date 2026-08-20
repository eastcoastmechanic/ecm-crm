import { protectedResourceHandler, metadataCorsOptionsRequestHandler } from "mcp-handler";

const issuer = process.env.NEXT_PUBLIC_APP_URL ?? "https://ecm-crm.vercel.app";

// Explicit resourceUrl -- protectedResourceHandler's default derives
// "resource" by stripping the /.well-known/<name> prefix off this route's
// own path, which would collapse to the bare origin since this route isn't
// nested under /api/mcp. Point it at the real MCP endpoint instead.
const handler = protectedResourceHandler({
  authServerUrls: [issuer],
  resourceUrl: `${issuer}/api/mcp`,
});

export { handler as GET };
export const OPTIONS = metadataCorsOptionsRequestHandler();
