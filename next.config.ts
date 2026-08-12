import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Vercel caps serverless request bodies at 4.5MB and this setting cannot
      // raise that — it only relaxes Next's own check. Setting 15mb here made
      // the app accept forms the platform then truncated, surfacing as
      // "Unexpected end of form" from the multipart parser, which points
      // nowhere near the real cause. 4mb keeps Next's limit just inside the
      // platform's so an oversized upload is rejected with a size error.
      // Photos are downscaled client-side before upload (lib/downscale-image.ts).
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
