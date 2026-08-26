import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { verifyInternalCredentials } from "@/lib/internal-auth";

const PUBLIC_PORTAL_PATHS = ["/portal/login", "/portal/auth"];

const INTERNAL_PATH_PREFIXES = [
  "/dashboard",
  "/account",
  "/customers",
  "/properties",
  "/equipment",
  "/price-book",
  "/catalog",
  "/documents",
  "/diagnostics",
  "/jobs",
  "/leads",
  "/tasks",
  "/inventory",
  "/analytics",
  "/mass-save",
  "/conversations",
  "/api/twilio/recordings",
];

const INTERNAL_API_PATHS = ["/api/internal-chat", "/api/dispatch/optimize", "/api/ingest/readings", "/api/ingest/quote"];

function isInternalPath(pathname: string) {
  if (INTERNAL_API_PATHS.includes(pathname)) return true;
  return INTERNAL_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function hasValidBasicAuth(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;

  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;

  return verifyInternalCredentials(decoded.slice(0, sep), decoded.slice(sep + 1));
}

async function checkStaffSession(
  request: NextRequest
): Promise<{ role: string | null; response: NextResponse }> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { role: null, response };

  const { data: staff } = await supabase
    .from("staff")
    .select("role")
    .eq("auth_user_id", user.id)
    .single();

  return { role: staff?.role ?? null, response };
}

export async function proxy(request: NextRequest) {
  if (isInternalPath(request.nextUrl.pathname)) {
    if (hasValidBasicAuth(request)) return NextResponse.next();

    const { role, response } = await checkStaffSession(request);
    if (!role) {
      if (INTERNAL_API_PATHS.includes(request.nextUrl.pathname)) {
        return new NextResponse("Authentication required", { status: 401 });
      }
      const redirectTarget = request.nextUrl.pathname + request.nextUrl.search;
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      url.searchParams.set("redirect", redirectTarget);
      return NextResponse.redirect(url);
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-staff-role", role);
    const finalResponse = NextResponse.next({ request: { headers: requestHeaders } });
    response.cookies.getAll().forEach((cookie) => finalResponse.cookies.set(cookie));
    return finalResponse;
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPortalPath = PUBLIC_PORTAL_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  );

  if (!user && request.nextUrl.pathname.startsWith("/portal") && !isPublicPortalPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/portal/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/portal/:path*",
    "/dashboard/:path*",
    "/dashboard",
    "/account/:path*",
    "/account",
    "/customers/:path*",
    "/customers",
    "/properties/:path*",
    "/properties",
    "/equipment/:path*",
    "/equipment",
    "/price-book/:path*",
    "/price-book",
    "/catalog/:path*",
    "/catalog",
    "/documents/:path*",
    "/documents",
    "/diagnostics/:path*",
    "/diagnostics",
    "/jobs/:path*",
    "/jobs",
    "/leads/:path*",
    "/leads",
    "/tasks/:path*",
    "/tasks",
    "/inventory/:path*",
    "/inventory",
    "/analytics/:path*",
    "/analytics",
    "/mass-save/:path*",
    "/mass-save",
    "/conversations/:path*",
    "/conversations",
    "/api/twilio/recordings/:path*",
    "/api/internal-chat",
    "/api/ingest/readings",
    "/api/ingest/quote",
    "/api/dispatch/optimize",
  ],
};
