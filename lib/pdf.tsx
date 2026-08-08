import path from "path";
import { readFile } from "fs/promises";
import { Document, Page, View, Text, Image, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import { COMPANY_SLOGAN } from "./brand";
import { registerBrandFonts, BODY_FONT, DISPLAY_FONT } from "./pdf-fonts";

export type PdfLineItem = {
  category: string;
  description: string;
  qty: number;
  unit: string;
  good: number | null;
  better: number | null;
  best: number | null;
  notes: string | null;
};

export type PdfDocumentData = {
  doc_number: string | null;
  type: "estimate" | "invoice" | "proposal";
  created_at: string;
  customer_name: string;
  property_address: string | null;
  line_items: PdfLineItem[];
  brand: { good: string | null; better: string | null; best: string | null };
  mass_save_eligible: boolean;
  mass_save_note: string | null;
  totals: { good: number; better: number; best: number };
  pricing_mode?: "tiered" | "flat";
};

const typeLabel: Record<PdfDocumentData["type"], string> = {
  estimate: "Estimate",
  invoice: "Invoice",
  proposal: "Proposal",
};

Font.registerHyphenationCallback((word) => [word]);
registerBrandFonts();

// Same palette as app/globals.css, so a printed document reads as the same
// brand as the website/CRM rather than a generic grey PDF.
const colors = {
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
  white: "#ffffff",
};

let logoDataUri: string | null = null;
async function getLogoDataUri(): Promise<string | null> {
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

const styles = StyleSheet.create({
  page: {
    fontFamily: BODY_FONT,
    fontSize: 9,
    color: colors.g700,
    paddingBottom: 56,
  },
  topBar: {
    height: 5,
    backgroundColor: colors.accent,
  },
  header: {
    backgroundColor: colors.navy,
    paddingHorizontal: 32,
    paddingVertical: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logo: {
    // 52x44 keeps the mark's own 1.18:1 ratio so it isn't squashed; the old
    // 32x32 square both shrank and distorted it. No borderRadius — the badge
    // is round with transparent corners, so rounding the box did nothing.
    width: 52,
    height: 44,
  },
  companyName: {
    color: colors.white,
    fontFamily: DISPLAY_FONT,
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: 0.75,
  },
  companyTag: {
    color: colors.brand,
    fontSize: 8,
    fontFamily: BODY_FONT,
    fontWeight: 600,
    letterSpacing: 0.3,
    marginTop: 3,
  },
  docTypePill: {
    alignSelf: "flex-end",
    backgroundColor: colors.accent,
    color: colors.white,
    fontSize: 9,
    fontFamily: BODY_FONT,
    fontWeight: 700,
    letterSpacing: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  docNumber: {
    color: colors.white,
    fontSize: 12,
    fontFamily: BODY_FONT,
    fontWeight: 700,
    textAlign: "right",
    marginTop: 5,
  },
  docMeta: {
    color: colors.g300,
    fontSize: 8,
    textAlign: "right",
    marginTop: 2,
  },
  body: {
    paddingHorizontal: 32,
    paddingTop: 22,
  },
  customerBlock: {
    marginBottom: 16,
  },
  preparedFor: {
    fontSize: 7,
    fontFamily: BODY_FONT,
    fontWeight: 700,
    color: colors.highlight,
    letterSpacing: 1.5,
    marginBottom: 3,
  },
  customerName: {
    fontSize: 12,
    fontFamily: BODY_FONT,
    fontWeight: 700,
    color: colors.navy,
  },
  customerSub: {
    fontSize: 9,
    color: colors.g500,
    marginTop: 2,
  },
  massSave: {
    flexDirection: "row",
    borderRadius: 4,
    marginBottom: 16,
    overflow: "hidden",
  },
  massSaveBar: {
    width: 4,
    backgroundColor: colors.green,
  },
  massSaveBody: {
    flex: 1,
    backgroundColor: colors.greenL,
    padding: 10,
  },
  massSaveTitle: {
    fontSize: 8,
    fontFamily: BODY_FONT,
    fontWeight: 700,
    color: colors.green,
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  massSaveNote: {
    fontSize: 8.5,
    color: colors.g700,
    lineHeight: 1.4,
  },
  tierRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 18,
  },
  tierCard: {
    flex: 1,
    borderRadius: 5,
    backgroundColor: colors.off,
    paddingTop: 12,
    paddingBottom: 10,
    paddingHorizontal: 8,
    textAlign: "center",
  },
  tierCardTopBlue: { borderTopWidth: 3, borderTopColor: colors.blue },
  tierCardTopHighlight: { borderTopWidth: 3, borderTopColor: colors.highlight },
  tierCardBetter: {
    backgroundColor: colors.navy,
    paddingTop: 8,
  },
  ribbon: {
    alignSelf: "center",
    backgroundColor: colors.highlight,
    color: colors.navy,
    fontSize: 6.5,
    fontFamily: BODY_FONT,
    fontWeight: 700,
    letterSpacing: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    marginBottom: 6,
  },
  tierLabel: {
    fontSize: 7.5,
    fontFamily: BODY_FONT,
    fontWeight: 700,
    color: colors.g500,
    letterSpacing: 1,
    marginBottom: 4,
  },
  tierLabelLight: {
    color: colors.g300,
  },
  tierPrice: {
    fontSize: 16,
    fontFamily: BODY_FONT,
    fontWeight: 700,
    color: colors.navy,
  },
  tierPriceLight: {
    color: colors.white,
  },
  tierBrand: {
    fontSize: 7.5,
    color: colors.g500,
    marginTop: 3,
  },
  tierBrandLight: {
    color: colors.g300,
  },
  flatTotalCard: {
    alignSelf: "flex-start",
    backgroundColor: colors.navy,
    borderRadius: 5,
    paddingTop: 12,
    paddingBottom: 10,
    paddingHorizontal: 20,
    textAlign: "center",
    marginBottom: 18,
  },
  table: {
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.g100,
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: colors.navy,
    paddingVertical: 7,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.g100,
    paddingVertical: 7,
  },
  tableRowAlt: {
    backgroundColor: colors.off,
  },
  th: {
    fontSize: 7,
    fontFamily: BODY_FONT,
    fontWeight: 700,
    color: colors.white,
    letterSpacing: 0.5,
    paddingHorizontal: 6,
  },
  thPrice: {
    color: colors.highlight,
  },
  td: {
    fontSize: 8.5,
    paddingHorizontal: 6,
  },
  colDesc: { width: "46%" },
  colQty: { width: "12%", textAlign: "center" },
  colPrice: { width: "14%", textAlign: "right" },
  colDescFlat: { width: "62%" },
  colPriceFlat: { width: "26%", textAlign: "right" },
  descTitle: {
    fontFamily: BODY_FONT,
    fontWeight: 700,
    color: colors.navy,
  },
  descSub: {
    fontSize: 7,
    color: colors.g300,
    marginTop: 1,
  },
  totalDueRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 12,
  },
  totalDueBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.accent,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  totalDueLabel: {
    color: colors.white,
    fontSize: 8,
    fontFamily: BODY_FONT,
    fontWeight: 700,
    letterSpacing: 1,
  },
  totalDueAmount: {
    color: colors.white,
    fontSize: 14,
    fontFamily: BODY_FONT,
    fontWeight: 700,
  },
  closingNote: {
    marginTop: 22,
    textAlign: "center",
    fontSize: 8,
    color: colors.g300,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.navy2,
    paddingHorizontal: 32,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footerLeft: {
    fontSize: 7.5,
    color: colors.g300,
  },
  footerRight: {
    fontSize: 7.5,
    color: colors.g300,
  },
});

function formatPrice(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function DocumentPdf({ doc, logo }: { doc: PdfDocumentData; logo: string | null }) {
  const isFlat = doc.pricing_mode === "flat";
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.topBar} fixed />
        <View style={styles.header} fixed>
          <View style={styles.headerLeft}>
            {logo && <Image src={logo} style={styles.logo} />}
            <View>
              <Text style={styles.companyName}>EAST COAST MECHANICAL</Text>
              <Text style={styles.companyTag}>{COMPANY_SLOGAN}</Text>
            </View>
          </View>
          <View>
            <Text style={styles.docTypePill}>{typeLabel[doc.type].toUpperCase()}</Text>
            <Text style={styles.docNumber}>{doc.doc_number ?? ""}</Text>
            <Text style={styles.docMeta}>
              {new Date(doc.created_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </Text>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.customerBlock}>
            <Text style={styles.preparedFor}>PREPARED FOR</Text>
            <Text style={styles.customerName}>{doc.customer_name}</Text>
            {doc.property_address && <Text style={styles.customerSub}>{doc.property_address}</Text>}
          </View>

          {doc.mass_save_eligible && doc.mass_save_note && (
            <View style={styles.massSave}>
              <View style={styles.massSaveBar} />
              <View style={styles.massSaveBody}>
                <Text style={styles.massSaveTitle}>MASSSAVE ELIGIBLE</Text>
                <Text style={styles.massSaveNote}>{doc.mass_save_note}</Text>
              </View>
            </View>
          )}

          {isFlat ? (
            <View style={styles.flatTotalCard}>
              <Text style={styles.ribbon}>TOTAL</Text>
              <Text style={{ ...styles.tierPrice, ...styles.tierPriceLight }}>
                {formatPrice(doc.totals.better)}
              </Text>
              {doc.brand.better && (
                <Text style={{ ...styles.tierBrand, ...styles.tierBrandLight }}>{doc.brand.better}</Text>
              )}
            </View>
          ) : (
            <View style={styles.tierRow}>
              <View style={{ ...styles.tierCard, ...styles.tierCardTopBlue }}>
                <Text style={styles.tierLabel}>GOOD</Text>
                <Text style={styles.tierPrice}>{formatPrice(doc.totals.good)}</Text>
                {doc.brand.good && <Text style={styles.tierBrand}>{doc.brand.good}</Text>}
              </View>
              <View style={styles.tierCardBetter}>
                {/* No ★ here: neither DM Sans nor the standard PDF fonts carry
                    U+2605, so it rendered as nothing and dragged a Helvetica
                    fallback into every tiered document. */}
                <Text style={styles.ribbon}>RECOMMENDED</Text>
                <Text style={{ ...styles.tierLabel, ...styles.tierLabelLight }}>BETTER</Text>
                <Text style={{ ...styles.tierPrice, ...styles.tierPriceLight }}>
                  {formatPrice(doc.totals.better)}
                </Text>
                {doc.brand.better && (
                  <Text style={{ ...styles.tierBrand, ...styles.tierBrandLight }}>{doc.brand.better}</Text>
                )}
              </View>
              <View style={{ ...styles.tierCard, ...styles.tierCardTopHighlight }}>
                <Text style={styles.tierLabel}>BEST</Text>
                <Text style={styles.tierPrice}>{formatPrice(doc.totals.best)}</Text>
                {doc.brand.best && <Text style={styles.tierBrand}>{doc.brand.best}</Text>}
              </View>
            </View>
          )}

          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={{ ...styles.th, ...(isFlat ? styles.colDescFlat : styles.colDesc) }}>DESCRIPTION</Text>
              <Text style={{ ...styles.th, ...styles.colQty }}>QTY</Text>
              {isFlat ? (
                <Text style={{ ...styles.th, ...styles.thPrice, ...styles.colPriceFlat }}>PRICE</Text>
              ) : (
                <>
                  <Text style={{ ...styles.th, ...styles.colPrice }}>GOOD</Text>
                  <Text style={{ ...styles.th, ...styles.thPrice, ...styles.colPrice }}>BETTER</Text>
                  <Text style={{ ...styles.th, ...styles.colPrice }}>BEST</Text>
                </>
              )}
            </View>
            {doc.line_items.map((item, i) => {
              const isLast = i === doc.line_items.length - 1;
              const rowStyle = {
                ...styles.tableRow,
                ...(i % 2 === 1 ? styles.tableRowAlt : {}),
                ...(isLast ? { borderBottomWidth: 0 } : {}),
              };
              return (
                <View key={i} style={rowStyle} wrap={false}>
                  <View style={{ ...styles.td, ...(isFlat ? styles.colDescFlat : styles.colDesc) }}>
                    <Text style={styles.descTitle}>{item.description}</Text>
                    <Text style={styles.descSub}>
                      {item.category}
                      {item.notes ? ` · ${item.notes}` : ""}
                    </Text>
                  </View>
                  <Text style={{ ...styles.td, ...styles.colQty }}>
                    {item.qty} {item.unit}
                  </Text>
                  {isFlat ? (
                    <Text style={{ ...styles.td, ...styles.colPriceFlat }}>{formatPrice(item.better)}</Text>
                  ) : (
                    <>
                      <Text style={{ ...styles.td, ...styles.colPrice }}>{formatPrice(item.good)}</Text>
                      <Text style={{ ...styles.td, ...styles.colPrice }}>{formatPrice(item.better)}</Text>
                      <Text style={{ ...styles.td, ...styles.colPrice }}>{formatPrice(item.best)}</Text>
                    </>
                  )}
                </View>
              );
            })}
          </View>

          <View style={styles.totalDueRow} wrap={false}>
            <View style={styles.totalDueBox}>
              <Text style={styles.totalDueLabel}>{doc.type === "invoice" ? "AMOUNT DUE" : "TOTAL"}</Text>
              <Text style={styles.totalDueAmount}>{formatPrice(doc.totals.better)}</Text>
            </View>
          </View>

          <Text style={styles.closingNote}>
            Thank you for the opportunity to earn your business. Questions? Call (774) 343-6369 or visit
            eastcoastmechanical.org.
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerLeft}>East Coast Mechanical · (774) 343-6369 · eastcoastmechanical.org</Text>
          <Text
            style={styles.footerRight}
            render={({ pageNumber, totalPages }) => `${doc.doc_number ?? ""}  ·  Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

export async function renderDocumentPdf(doc: PdfDocumentData): Promise<Buffer> {
  const logo = await getLogoDataUri();
  return renderToBuffer(<DocumentPdf doc={doc} logo={logo} />);
}
