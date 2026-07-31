import { NextResponse } from "next/server";
import type { MetadataRoute } from "next";

// Next.js's manifest.ts file convention only routes at the true app root
// (its internal metadata-route regex is anchored to the root path), so the
// portal's own manifest — scoped separately from the CRM's — is served here
// instead and linked via `metadata.manifest` in app/portal/layout.tsx.
export async function GET() {
  const manifest: MetadataRoute.Manifest = {
    name: "East Coast Mechanical",
    short_name: "ECM",
    start_url: "/portal",
    scope: "/portal/",
    display: "standalone",
    background_color: "#0a1628",
    theme_color: "#0a1628",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };

  return NextResponse.json(manifest, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
