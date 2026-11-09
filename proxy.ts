import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  INTERNAL_REQUEST_HEADERS,
  STAFF_ROLE_HEADER,
  STAFF_ROLE_PROOF_HEADER,
  signStaffRole,
} from "@/lib/staff-role-proof";

const PUBLIC_PORTAL_PATHS = ["/portal/login", "/portal/auth"];

export const INTERNAL_PATH_PREFIXES = [
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
  "/hours",
  "/dispatch",
  "/mass-save",
  "/conversations",
  "/payments",
  "/field-board",
  "/tech-hub",
  "/procurement",
  "/campaigns",
  "/log",
  "/pm",
  "/api/twilio/recordings",
];

// Techs use the truck screen, the PM checklists they fill on a phone, and their own account page (password change only).
// Everything else (money, customers, analytics, documents, the assistant) is
// blocked here on the server, not just hidden from the menu.
// The print sheet is excluded on purpose: it lists unpaid invoice amounts.
const TECH_ALLOWED_PATHS = ["/field-board", "/pm", "/account"];
const TECH_BLOCKED_PATHS = ["/field-board/print"];

// A tech may start a service report and open one report page, but not the report
// list, the PDF, or anything else under /diagnostics (those carry customer history and prices).
const TECH_DIAGNOSTIC_PATH = /^\/diagnostics\/(new|[0-9a-f-]{36})\/?$/i;

// Same for the install checklist: start one, open one, never the list of all reports.
const TECH_INSTALL_PATH = /^\/tech-hub\/install-report\/(new|[0-9a-f-]{36})\/?$/i;

function techMayAccess(pathname: string) {
  if (TECH_BLOCKED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
  if (TECH_DIAGNOSTIC_PATH.test(pathname) || TECH_INSTALL_PATH.test(pathname)) return true;
  return TECH_ALLOWED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const INTERNAL_API_PATHS = ["/api/internal-chat", "/api/dispatch/optimize", "/api/microsoft/connect", "/api/microsoft/callback"];

export function isInternalPath(pathname: string) {
  if (INTERNAL_API_PATHS.includes(pathname)) return true;
  return INTERNAL_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
// Sample checklist for local review. The page 404s in production, and this
// skip is development-only, so it never opens the route on Vercel.
function isPreviewPath(pathname: string) {
  return process.env.NODE_ENV === "development" && pathname === "/pm/preview";
}

// No shared Basic-auth login: every internal page needs a staff sign-in, so
// each person has their own password and role. Machine callers (ingest, cron,
// webhooks, bots, MCP, OAuth) check their own key inside the route, not here:
// on those paths the proxy only strips the internal headers and passes them on.

/**
 * A copy of the request headers with every proxy-only header removed. Every
 * response below forwards headers through NextResponse.next({ request: { headers } }),
 * which makes Next replace the forwarded set with exactly these, so a
 * client-sent `x-staff-role` never reaches a page or route.
 */
export function stripInternalHeaders(source: Headers): Headers {
  const cleaned = new Headers(source);
  for (const name of INTERNAL_REQUEST_HEADERS) cleaned.delete(name);
  return cleaned;
}

function forward(requestHeaders: Headers) {
  return NextResponse.next({ request: { headers: requestHeaders } });
}

/** Forward with the verified role and its proof. No server secret means no role (fails closed). */
async function forwardWithRole(cleaned: Headers, role: string) {
  const requestHeaders = new Headers(cleaned);
  const proof = await signStaffRole(role);
  if (proof) {
    requestHeaders.set(STAFF_ROLE_HEADER, role);
    requestHeaders.set(STAFF_ROLE_PROOF_HEADER, proof);
  }
  return forward(requestHeaders);
}

function supabaseFor(request: NextRequest, cleaned: Headers, onResponse: (response: NextResponse) => void) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          // Keep the forwarded cookie line in step with the refreshed session.
          cleaned.set("cookie", request.headers.get("cookie") ?? "");
          const response = forward(cleaned);
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
          onResponse(response);
        },
      },
    }
  );
}

async function checkStaffSession(
  request: NextRequest,
  cleaned: Headers
): Promise<{ role: string | null; response: NextResponse }> {
  let response = forward(cleaned);
  const supabase = supabaseFor(request, cleaned, (next) => {
    response = next;
  });

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

function isPortalPath(pathname: string) {
  return pathname === "/portal" || pathname.startsWith("/portal/");
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Every request, public or not: drop any proxy-only header the caller sent.
  const cleaned = stripInternalHeaders(request.headers);

  if (isInternalPath(pathname)) {
    if (isPreviewPath(pathname)) {
      return forwardWithRole(cleaned, "owner");
    }
    const { role, response } = await checkStaffSession(request, cleaned);
    if (!role) {
      if (INTERNAL_API_PATHS.includes(pathname)) {
        return new NextResponse("Authentication required", { status: 401 });
      }
      const redirectTarget = pathname + request.nextUrl.search;
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      url.searchParams.set("redirect", redirectTarget);
      return NextResponse.redirect(url);
    }

    if (role === "tech" && !techMayAccess(pathname)) {
      if (pathname.startsWith("/api/")) {
        return new NextResponse("Forbidden", { status: 403 });
      }
      const url = request.nextUrl.clone();
      url.pathname = "/field-board";
      url.search = "";
      return NextResponse.redirect(url);
    }

    const finalResponse = await forwardWithRole(cleaned, role);
    response.cookies.getAll().forEach((cookie) => finalResponse.cookies.set(cookie));
    return finalResponse;
  }

  if (isPortalPath(pathname)) {
    let response = forward(cleaned);
    const supabase = supabaseFor(request, cleaned, (next) => {
      response = next;
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const isPublicPortalPath = PUBLIC_PORTAL_PATHS.some((path) => pathname.startsWith(path));

    if (!user && !isPublicPortalPath) {
      const url = request.nextUrl.clone();
      url.pathname = "/portal/login";
      return NextResponse.redirect(url);
    }

    return response;
  }

  // Website, login, survey, unsubscribe, and API routes that check their own
  // key: no sign-in lookup, just the stripped headers.
  return forward(cleaned);
}

export const config = {
  // Runs on every app route, so a new page can't be missed. Skipped only for
  // build output (_next/static, _next/image), the public asset folders, and
  // root-level files such as /favicon.ico, /logo.png, /sw.js, /robots.txt.
  // A file-like name below a folder (/customers/x.png) still goes through.
  matcher: [
    "/((?!_next/static/|_next/image|fonts/|icons/|site/|forms/|[^/]+\\.(?:ico|png|jpg|jpeg|gif|svg|webp|avif|js|json|txt|xml|webmanifest|ttf|woff2?|pdf|map)$).*)",
  ],
};
