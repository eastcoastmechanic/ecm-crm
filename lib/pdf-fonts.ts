import path from "path";
import { Font } from "@react-pdf/renderer";

/**
 * Registers the site's typefaces for PDF rendering so generated documents
 * match the website rather than falling back to Helvetica.
 *
 * DM Sans is the body face (--font-dm-sans) and Orbitron the display face
 * (--font-syne, a legacy variable name) — see app/layout.tsx.
 *
 * The TTFs are committed under public/fonts rather than fetched at render
 * time: these run inside serverless functions, and a network round-trip per
 * PDF would add latency and a failure mode for something that never changes.
 * @react-pdf/renderer cannot read the woff2 that next/font downloads, hence
 * the separate copies. Both families are OFL-licensed, so redistribution is
 * fine.
 */

const FONT_DIR = path.join(process.cwd(), "public", "fonts");

export const BODY_FONT = "DM Sans";
export const DISPLAY_FONT = "Orbitron";

let registered = false;

export function registerBrandFonts() {
  if (registered) return;

  // Static instances, not the variable TTFs Google now ships for these
  // families: @react-pdf/renderer embeds a single default instance from a
  // variable file and silently ignores fontWeight, so every bold heading,
  // price, and table header would render at regular weight.
  Font.register({
    family: BODY_FONT,
    fonts: [
      { src: path.join(FONT_DIR, "DMSans-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "DMSans-Medium.ttf"), fontWeight: 500 },
      // 600 is used by the letterhead tagline; without it registered,
      // react-pdf quietly falls back to Helvetica-Bold for that one line.
      { src: path.join(FONT_DIR, "DMSans-SemiBold.ttf"), fontWeight: 600 },
      { src: path.join(FONT_DIR, "DMSans-Bold.ttf"), fontWeight: 700 },
    ],
  });

  Font.register({
    family: DISPLAY_FONT,
    fonts: [{ src: path.join(FONT_DIR, "Orbitron-Bold.ttf"), fontWeight: 700 }],
  });

  registered = true;
}
