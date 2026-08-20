import { NextResponse } from "next/server";
import { metadataCorsOptionsRequestHandler } from "mcp-handler";

// RFC 8414 authorization server metadata. mcp-handler ships helpers for the
// RFC 9728 protected-resource side (see the sibling oauth-protected-resource
// route) but nothing for this one -- hand-written JSON.
const issuer = process.env.NEXT_PUBLIC_APP_URL ?? "https://ecm-crm.vercel.app";

export async function GET() {
  return NextResponse.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/api/oauth/authorize`,
      token_endpoint: `${issuer}/api/oauth/token`,
      registration_endpoint: `${issuer}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=3600" } }
  );
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
