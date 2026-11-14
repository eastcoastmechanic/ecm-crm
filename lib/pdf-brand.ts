import path from "path";
import { readFile } from "fs/promises";

// Same palette as app/globals.css, so a printed document reads as the same
// brand as the website/CRM rather than a generic grey PDF. Shared by the
// estimate/proposal PDF (lib/pdf.tsx) and the invoice PDF (lib/invoice-pdf.tsx).
export const colors = {
  navy: "#0a1628",
  navy2: "#0e1f3a",
  blue: "#1e3a5f",
  accent: "#e8502a",
  accent2: "#c43d20",
  highlight: "#558ae7",
  // Cyan sampled from the logo gradient (public/logo.png).
  brand: "#38b7e1",
  off: "#f4f6fa",
  g100: "#e2e8f0",
  g300: "#94a3b8",
  g500: "#64748b",
  g700: "#334155",
  green: "#16a34a",
  greenL: "#dcfce7",
  red: "#dc2626",
  white: "#ffffff",
};

let logoDataUri: string | null = null;
export async function getLogoDataUri(): Promise<string | null> {
  if (logoDataUri) return logoDataUri;
  try {
    // logo-mark.png is logo.png with its dead margin trimmed off. The source
    // file is 1280x1024 with the badge occupying only 698x582 of it, so at a
    // 32pt box the mark rendered around 17pt and the wordmark was unreadable.
    const buffer = await readFile(path.join(process.cwd(), "public", "logo-mark.png"));
    logoDataUri = `data:image/png;base64,${buffer.toString("base64")}`;
    return logoDataUri;
  } catch {
    // Missing/unreadable logo shouldn't block PDF generation.
    return null;
  }
}
