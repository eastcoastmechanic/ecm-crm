import { NextResponse } from "next/server";
import { z } from "zod";
import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import { supabase } from "@/lib/supabase";

/**
 * Dynamic Client Registration (RFC 7591) -- public, unauthenticated by
 * design (DCR has no pre-shared credential). A public/PKCE-only client, so
 * no client_secret is ever issued.
 *
 * z.object() silently strips any DCR field this doesn't select (grant_types,
 * contacts, logo_uri, ...) rather than erroring on them.
 */
const RegisterSchema = z.object({
  redirect_uris: z.array(z.string().url()).min(1),
  client_name: z.string().optional(),
});

function isAllowedRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === "https:") return true;
    // Local testing / a client running on the same machine during dev.
    return parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

const corsHeaders = { "Access-Control-Allow-Origin": "*" };

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "Request body must be valid JSON" },
      { status: 400, headers: corsHeaders }
    );
  }

  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: parsed.error.message },
      { status: 400, headers: corsHeaders }
    );
  }

  if (!parsed.data.redirect_uris.every(isAllowedRedirectUri)) {
    return NextResponse.json(
      { error: "invalid_redirect_uri", error_description: "redirect_uris must be https (or localhost for testing)" },
      { status: 400, headers: corsHeaders }
    );
  }

  const { data, error } = await supabase
    .from("oauth_clients")
    .insert({ redirect_uris: parsed.data.redirect_uris, client_name: parsed.data.client_name ?? null })
    .select("client_id")
    .single();
  if (error) {
    return NextResponse.json({ error: "server_error", error_description: error.message }, { status: 500, headers: corsHeaders });
  }

  return NextResponse.json(
    {
      client_id: data.client_id,
      redirect_uris: parsed.data.redirect_uris,
      client_name: parsed.data.client_name,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201, headers: corsHeaders }
  );
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
