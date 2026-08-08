import { Document, Page, View, Text, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import { COMPANY_SLOGAN } from "./brand";
import { registerBrandFonts, BODY_FONT, DISPLAY_FONT } from "./pdf-fonts";

export type WarrantyReportItem = {
  equipment_label: string;
  model: string | null;
  serial_number: string | null;
  install_date: string | null;
  manufacturer: {
    docket_number: string | null;
    years: number | null;
    registered: boolean;
    registration_date: string | null;
    expiration_date: string | null;
  };
  craftsmanship: {
    years: number;
    expiration_date: string | null;
  };
};

export type WarrantyReportPdfData = {
  doc_number: string | null;
  created_at: string;
  customer_name: string;
  property_address: string | null;
  technician_name: string | null;
  items: WarrantyReportItem[];
};

const MANUFACTURER_COVERAGE_TEXT =
  "Covers replacement parts found to be defective in material or workmanship, per the manufacturer's published terms. Does not cover labor beyond what the manufacturer specifies, or damage from misuse, neglect, lack of routine maintenance, or unauthorized repairs. Registration with the manufacturer (noted above) is required for full coverage — contact the manufacturer directly to file a parts claim using the docket number above.";

const CRAFTSMANSHIP_COVERAGE_TEXT =
  "East Coast Mechanical warrants that this installation was completed correctly and in accordance with manufacturer specifications and applicable code. If a defect in our workmanship causes a failure during the warranty period, we will repair or correct it at no charge for labor. Does not cover normal wear and tear, damage from misuse or lack of maintenance, acts of nature, or parts/work not installed by East Coast Mechanical.";

Font.registerHyphenationCallback((word) => [word]);

registerBrandFonts();

const colors = {
  navy: "#0a1628",
  // Cyan from the logo gradient (public/logo.png) -- the tagline colour.
  brand: "#38b7e1",
  accent: "#e8502a",
  g300: "#94a3b8",
  g700: "#334155",
  border: "#e2e8f0",
  green: "#16a34a",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const styles = StyleSheet.create({
  page: {
    fontFamily: BODY_FONT,
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
  companyName: { color: "#ffffff", fontSize: 16, fontWeight: 700, fontFamily: DISPLAY_FONT },
  companyTag: { color: colors.brand, fontSize: 8, letterSpacing: 1, marginTop: 2 },
  docTitle: { fontFamily: BODY_FONT, color: colors.accent, fontSize: 14, fontWeight: 700, textAlign: "right" },
  docMeta: { color: colors.g300, fontSize: 8, textAlign: "right", marginTop: 2 },
  body: { paddingHorizontal: 32, paddingTop: 20 },
  customerBlock: { marginBottom: 14 },
  customerName: { fontFamily: BODY_FONT, fontSize: 11, fontWeight: 700, color: colors.navy },
  customerSub: { fontSize: 9, color: colors.g700, marginTop: 2 },
  sectionLabel: {
    fontSize: 7.5,
    fontFamily: BODY_FONT,
    fontWeight: 700,
    color: colors.g300,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  itemCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    padding: 10,
    marginBottom: 12,
  },
  itemTitle: { fontFamily: BODY_FONT, fontSize: 11, fontWeight: 700, color: colors.navy },
  itemSub: { fontSize: 8.5, color: colors.g300, marginTop: 1, marginBottom: 8 },
  subCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    padding: 8,
    marginBottom: 6,
  },
  craftsCard: {
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: "#fdf1ee",
    borderRadius: 4,
    padding: 8,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  fieldText: { fontSize: 8.5, color: colors.g700, width: "50%", marginBottom: 3 },
  coverageText: { fontSize: 8, color: colors.g700, marginTop: 5, lineHeight: 1.4 },
  signatureBlock: { marginTop: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  signatureLabel: { fontSize: 7.5, color: colors.g300, marginBottom: 2 },
  signatureName: { fontFamily: BODY_FONT, fontSize: 10, fontWeight: 700, color: colors.navy },
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

export function WarrantyReportPdf({ doc }: { doc: WarrantyReportPdfData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.companyName}>East Coast Mechanical</Text>
            <Text style={styles.companyTag}>{COMPANY_SLOGAN}</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>{doc.doc_number ?? ""} — Warranty Registration</Text>
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
            {doc.technician_name && (
              <Text style={styles.customerSub}>Installed by {doc.technician_name}</Text>
            )}
          </View>

          {doc.items.map((item, i) => (
            <View key={i} style={styles.itemCard} wrap={false}>
              <Text style={styles.itemTitle}>{item.equipment_label}</Text>
              <Text style={styles.itemSub}>
                {item.model ? `Model ${item.model}` : "Model —"}
                {" · "}
                {item.serial_number ? `S/N ${item.serial_number}` : "S/N —"}
                {" · "}
                Installed {formatDate(item.install_date)}
              </Text>

              <View style={styles.subCard}>
                <Text style={{ ...styles.sectionLabel, color: colors.g300 }}>MANUFACTURER WARRANTY</Text>
                <View style={styles.row}>
                  <Text style={styles.fieldText}>Docket: {item.manufacturer.docket_number ?? "—"}</Text>
                  <Text style={styles.fieldText}>
                    Length: {item.manufacturer.years !== null ? `${item.manufacturer.years} yrs` : "—"}
                  </Text>
                  <Text style={styles.fieldText}>
                    Registered: {item.manufacturer.registered ? "Yes" : "No"}
                  </Text>
                  <Text style={styles.fieldText}>
                    Registry date: {formatDate(item.manufacturer.registration_date)}
                  </Text>
                  <Text style={styles.fieldText}>Starts: {formatDate(item.install_date)}</Text>
                  <Text style={styles.fieldText}>
                    Ends: {formatDate(item.manufacturer.expiration_date)}
                  </Text>
                </View>
                <Text style={styles.coverageText}>{MANUFACTURER_COVERAGE_TEXT}</Text>
              </View>

              <View style={styles.craftsCard}>
                <Text style={{ ...styles.sectionLabel, color: colors.accent }}>
                  CRAFTSMANSHIP WARRANTY — EAST COAST MECHANICAL
                </Text>
                <View style={styles.row}>
                  <Text style={styles.fieldText}>
                    Length: {item.craftsmanship.years} year{item.craftsmanship.years === 1 ? "" : "s"}{" "}
                    on labor
                  </Text>
                  <Text style={styles.fieldText}>Starts: {formatDate(item.install_date)}</Text>
                  <Text style={styles.fieldText}>
                    Ends: {formatDate(item.craftsmanship.expiration_date)}
                  </Text>
                </View>
                <Text style={styles.coverageText}>{CRAFTSMANSHIP_COVERAGE_TEXT}</Text>
              </View>
            </View>
          ))}

          <View style={styles.signatureBlock}>
            <Text style={styles.signatureLabel}>Issued by</Text>
            <Text style={styles.signatureName}>Joshua Crowley</Text>
            <Text style={styles.customerSub}>Owner, East Coast Mechanical</Text>
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

export async function renderWarrantyReportPdf(doc: WarrantyReportPdfData): Promise<Buffer> {
  return renderToBuffer(<WarrantyReportPdf doc={doc} />);
}
