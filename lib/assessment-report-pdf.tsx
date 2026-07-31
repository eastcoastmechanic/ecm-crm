import { Document, Page, View, Text, Image, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";

export type AssessmentItem = {
  equipment_id: string | null;
  equipment_label: string;
  equipment_serial: string | null;
  age_years: number | null;
  condition: string;
  observations: string;
  photos: { url: string; caption: string | null }[];
  condition_summary: string;
  recommendation: "no_action" | "monitor" | "repair" | "replace";
  estimated_remaining_life_years: number | null;
};

export type AssessmentReportPdfData = {
  doc_number: string | null;
  created_at: string;
  customer_name: string;
  property_address: string | null;
  items: AssessmentItem[];
  overall_summary: string;
};

Font.registerHyphenationCallback((word) => [word]);

const colors = {
  navy: "#0a1628",
  accent: "#e8502a",
  g300: "#94a3b8",
  g700: "#334155",
  border: "#e2e8f0",
  green: "#16a34a",
  amber: "#d97706",
  red: "#dc2626",
};

const recommendationLabel: Record<string, string> = {
  no_action: "No Action Needed",
  monitor: "Monitor",
  repair: "Repair Recommended",
  replace: "Replacement Recommended",
};

const recommendationColor: Record<string, string> = {
  no_action: colors.green,
  monitor: colors.amber,
  repair: colors.amber,
  replace: colors.red,
};

const conditionLabel: Record<string, string> = {
  working_well: "Working Well",
  working_with_issues: "Working, With Issues",
  not_working: "Not Working",
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
  companyName: { color: "#ffffff", fontSize: 16, fontWeight: 700 },
  companyTag: { color: colors.g300, fontSize: 8, letterSpacing: 1, marginTop: 2 },
  docTitle: { color: colors.accent, fontSize: 14, fontWeight: 700, textAlign: "right" },
  docMeta: { color: colors.g300, fontSize: 8, textAlign: "right", marginTop: 2 },
  body: { paddingHorizontal: 32, paddingTop: 20 },
  customerBlock: { marginBottom: 14 },
  customerName: { fontSize: 11, fontWeight: 700, color: colors.navy },
  customerSub: { fontSize: 9, color: colors.g700, marginTop: 2 },
  overallSummary: {
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: "#fdf1ee",
    borderRadius: 4,
    padding: 10,
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 7.5,
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
  itemTitle: { fontSize: 11, fontWeight: 700, color: colors.navy },
  itemSub: { fontSize: 8.5, color: colors.g300, marginTop: 1, marginBottom: 6 },
  badgeRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  badge: {
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    fontSize: 7.5,
    fontWeight: 700,
    color: "#ffffff",
  },
  bodyText: { fontSize: 8.5, lineHeight: 1.4, color: colors.g700, marginBottom: 4 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  photo: { width: 100, height: 75, borderRadius: 3, objectFit: "cover" },
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

export function AssessmentReportPdf({ doc }: { doc: AssessmentReportPdfData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.companyName}>East Coast Mechanical</Text>
            <Text style={styles.companyTag}>HVAC &amp; PLUMBING</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>{doc.doc_number ?? ""} — Condition Assessment</Text>
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

          <View style={styles.overallSummary}>
            <Text style={{ ...styles.sectionLabel, color: colors.accent }}>SYSTEM OVERVIEW</Text>
            <Text style={styles.bodyText}>{doc.overall_summary}</Text>
          </View>

          {doc.items.map((item, i) => (
            <View key={i} style={styles.itemCard} wrap={false}>
              <Text style={styles.itemTitle}>{item.equipment_label}</Text>
              <Text style={styles.itemSub}>
                {item.equipment_serial ? `S/N ${item.equipment_serial} · ` : ""}
                {item.age_years !== null ? `${item.age_years} years old` : "Age unknown"}
                {" · "}
                {conditionLabel[item.condition] ?? item.condition}
              </Text>

              <View style={styles.badgeRow}>
                <Text
                  style={{
                    ...styles.badge,
                    backgroundColor: recommendationColor[item.recommendation] ?? colors.g300,
                  }}
                >
                  {recommendationLabel[item.recommendation] ?? item.recommendation}
                </Text>
                {item.estimated_remaining_life_years !== null && (
                  <Text style={{ ...styles.badge, backgroundColor: colors.navy }}>
                    ~{item.estimated_remaining_life_years} yrs remaining
                  </Text>
                )}
              </View>

              <Text style={styles.bodyText}>{item.condition_summary}</Text>

              {item.photos.length > 0 && (
                <View style={styles.photoRow}>
                  {item.photos.map((photo, pi) => (
                    <Image key={pi} src={photo.url} style={styles.photo} />
                  ))}
                </View>
              )}
            </View>
          ))}
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

export async function renderAssessmentReportPdf(doc: AssessmentReportPdfData): Promise<Buffer> {
  return renderToBuffer(<AssessmentReportPdf doc={doc} />);
}
