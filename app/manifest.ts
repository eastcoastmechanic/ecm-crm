import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "East Coast Mechanical CRM",
    short_name: "ECM CRM",
    start_url: "/dashboard",
    scope: "/",
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
}
