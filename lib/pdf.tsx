import { Document, Page, View, Text, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";

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

const colors = {
  navy: "#0a1628",
  navy2: "#0e1f3a",
  accent: "#e8502a",
  gold: "#f5a623",
  g300: "#94a3b8",
  g700: "#334155",
  border: "#e2e8f0",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: colors.g700,
    paddingBottom: 48,
  },
  header: {
    backgroundColor: colors.navy,
    paddingHorizontal: 32,
    paddingVertical: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  companyName: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: 700,
  },
  companyTag: {
    color: colors.g300,
    fontSize: 8,
    letterSpacing: 1,
    marginTop: 2,
  },
  docTitle: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: 700,
    textAlign: "right",
  },
  docMeta: {
    color: colors.g300,
    fontSize: 8,
    textAlign: "right",
    marginTop: 2,
  },
  body: {
    paddingHorizontal: 32,
    paddingTop: 20,
  },
  customerBlock: {
    marginBottom: 16,
  },
  customerName: {
    fontSize: 11,
    fontWeight: 700,
    color: colors.navy,
  },
  customerSub: {
    fontSize: 9,
    color: colors.g700,
    marginTop: 2,
  },
  massSave: {
    borderWidth: 1,
    borderColor: "#16a34a",
    backgroundColor: "#f0fdf4",
    borderRadius: 4,
    padding: 10,
    marginBottom: 16,
  },
  massSaveTitle: {
    fontSize: 8,
    fontWeight: 700,
    color: "#16a34a",
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
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    padding: 10,
    textAlign: "center",
  },
  tierCardBetter: {
    borderColor: colors.accent,
    borderWidth: 1.5,
  },
  tierLabel: {
    fontSize: 7.5,
    fontWeight: 700,
    color: colors.g300,
    letterSpacing: 1,
    marginBottom: 4,
  },
  tierPrice: {
    fontSize: 15,
    fontWeight: 700,
    color: colors.navy,
  },
  tierBrand: {
    fontSize: 7.5,
    color: colors.g300,
    marginTop: 3,
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#f4f6fa",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
  },
  th: {
    fontSize: 7,
    fontWeight: 700,
    color: colors.g300,
    letterSpacing: 0.5,
    paddingHorizontal: 6,
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
  flatCardWrap: { flexDirection: "row", marginBottom: 18 },
  descTitle: {
    fontWeight: 700,
    color: colors.navy,
  },
  descSub: {
    fontSize: 7,
    color: colors.g300,
    marginTop: 1,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 32,
    paddingVertical: 12,
    fontSize: 7,
    color: colors.g300,
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});

function formatPrice(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function DocumentPdf({ doc }: { doc: PdfDocumentData }) {
  const isFlat = doc.pricing_mode === "flat";
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.companyName}>East Coast Mechanical</Text>
            <Text style={styles.companyTag}>HVAC &amp; PLUMBING</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>
              {doc.doc_number ?? ""} — {typeLabel[doc.type]}
            </Text>
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
            <Text style={styles.customerName}>{doc.customer_name}</Text>
            {doc.property_address && <Text style={styles.customerSub}>{doc.property_address}</Text>}
          </View>

          {doc.mass_save_eligible && doc.mass_save_note && (
            <View style={styles.massSave}>
              <Text style={styles.massSaveTitle}>MASSSAVE ELIGIBLE</Text>
              <Text style={styles.massSaveNote}>{doc.mass_save_note}</Text>
            </View>
          )}

          {isFlat ? (
            <View style={styles.flatCardWrap}>
              <View style={{ ...styles.tierCard, ...styles.tierCardBetter, flex: 0, width: 160 }}>
                <Text style={styles.tierLabel}>TOTAL</Text>
                <Text style={styles.tierPrice}>{formatPrice(doc.totals.better)}</Text>
                {doc.brand.better && <Text style={styles.tierBrand}>{doc.brand.better}</Text>}
              </View>
            </View>
          ) : (
            <View style={styles.tierRow}>
              {(["good", "better", "best"] as const).map((tier) => (
                <View
                  key={tier}
                  style={tier === "better" ? { ...styles.tierCard, ...styles.tierCardBetter } : styles.tierCard}
                >
                  <Text style={styles.tierLabel}>{tier === "better" ? "BETTER (RECOMMENDED)" : tier.toUpperCase()}</Text>
                  <Text style={styles.tierPrice}>{formatPrice(doc.totals[tier])}</Text>
                  {doc.brand[tier] && <Text style={styles.tierBrand}>{doc.brand[tier]}</Text>}
                </View>
              ))}
            </View>
          )}

          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={{ ...styles.th, ...(isFlat ? styles.colDescFlat : styles.colDesc) }}>DESCRIPTION</Text>
              <Text style={{ ...styles.th, ...styles.colQty }}>QTY</Text>
              {isFlat ? (
                <Text style={{ ...styles.th, ...styles.colPriceFlat }}>PRICE</Text>
              ) : (
                <>
                  <Text style={{ ...styles.th, ...styles.colPrice }}>GOOD</Text>
                  <Text style={{ ...styles.th, ...styles.colPrice }}>BETTER</Text>
                  <Text style={{ ...styles.th, ...styles.colPrice }}>BEST</Text>
                </>
              )}
            </View>
            {doc.line_items.map((item, i) => (
              <View
                key={i}
                style={i === doc.line_items.length - 1 ? { ...styles.tableRow, borderBottomWidth: 0 } : styles.tableRow}
                wrap={false}
              >
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
            ))}
          </View>
        </View>

        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `East Coast Mechanical · ${doc.doc_number ?? ""}  ·  Page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

export async function renderDocumentPdf(doc: PdfDocumentData): Promise<Buffer> {
  return renderToBuffer(<DocumentPdf doc={doc} />);
}
