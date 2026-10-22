import { Document, Page, View, Text, Image, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import { COMPANY_EMAIL, COMPANY_NAME, COMPANY_PHONE_DISPLAY } from "@/lib/brand";
import { registerBrandFonts, BODY_FONT, DISPLAY_FONT } from "@/lib/pdf-fonts";
import { PM_REPORT_TAGLINE } from "@/lib/pm/branding";
import type { PmReportModel, PmResult } from "@/lib/pm/types";

Font.registerHyphenationCallback((word) => [word]);
registerBrandFonts();

const colors = {
  navy: "#0a1628",
  brand: "#38b7e1",
  accent: "#e8502a",
  g300: "#94a3b8",
  g700: "#334155",
  border: "#e2e8f0",
  green: "#166534",
  failBg: "#fdf1ee",
};

const styles = StyleSheet.create({
  page: { fontFamily: BODY_FONT, fontSize: 9, color: colors.g700, paddingBottom: 56 },
  header: { backgroundColor: colors.navy, paddingHorizontal: 32, paddingVertical: 16 },
  companyName: { color: "#ffffff", fontSize: 16, fontFamily: DISPLAY_FONT, fontWeight: 700 },
  tagline: { color: colors.brand, fontSize: 8, marginTop: 3, letterSpacing: 0.4 },
  contact: { color: "#dbe7f3", fontSize: 8, marginTop: 4 },
  docTitle: { color: colors.accent, fontSize: 12, fontWeight: 700, marginTop: 8 },
  docMeta: { color: colors.g300, fontSize: 8, marginTop: 2 },
  body: { paddingHorizontal: 32, paddingTop: 16 },
  customerName: { fontSize: 12, fontWeight: 700, color: colors.navy },
  sub: { fontSize: 9, color: colors.g700, marginTop: 2 },
  summaryRow: { flexDirection: "row", gap: 8, marginTop: 12, marginBottom: 12 },
  summaryCard: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 4, padding: 6 },
  summaryLabel: { fontSize: 7, color: colors.g300, fontWeight: 700 },
  summaryValue: { fontSize: 12, fontWeight: 700, color: colors.navy, marginTop: 2 },
  sectionLabel: { fontSize: 8, fontWeight: 700, color: colors.navy, marginTop: 8, marginBottom: 4 },
  row: { borderWidth: 1, borderColor: colors.border, borderRadius: 3, padding: 6, marginBottom: 4 },
  failRow: { borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.failBg, borderRadius: 3, padding: 6, marginBottom: 4 },
  rowTop: { flexDirection: "row", justifyContent: "space-between" },
  itemLabel: { fontSize: 9, fontWeight: 700, color: colors.navy, width: "78%" },
  result: { fontSize: 8, fontWeight: 700 },
  readings: { fontSize: 8, color: colors.g700, marginTop: 2 },
  notes: { fontSize: 8, color: colors.g700, marginTop: 2 },
  callout: { borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.failBg, borderRadius: 4, padding: 8, marginBottom: 8 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  photo: { width: 120, height: 90, objectFit: "cover", borderRadius: 3 },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 32,
    paddingVertical: 10,
    fontSize: 7,
    color: colors.g300,
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});

function resultLabel(result: PmResult | null): string {
  if (result === "pass") return "PASS";
  if (result === "fail") return "FAIL";
  if (result === "na") return "N/A";
  return "OPEN";
}

function resultColor(result: PmResult | null): string {
  if (result === "pass") return colors.green;
  if (result === "fail") return colors.accent;
  return colors.g300;
}

export function PmReportPdf({ report }: { report: PmReportModel }) {
  const photos = report.sections.flatMap((section) =>
    section.items.flatMap((item) => item.photos.filter((photo) => photo.url).map((photo) => ({ ...photo, label: item.label })))
  );

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header} fixed>
          <Text style={styles.companyName}>{COMPANY_NAME}</Text>
          <Text style={styles.tagline}>{PM_REPORT_TAGLINE}</Text>
          <Text style={styles.contact}>
            {COMPANY_PHONE_DISPLAY} · {COMPANY_EMAIL}
          </Text>
          <Text style={styles.docTitle}>{report.doc_number ? `${report.doc_number} — ` : ""}{report.title}</Text>
          <Text style={styles.docMeta}>
            {report.date_label}
            {report.tech_name ? ` · Tech ${report.tech_name}` : ""}
            {` · ${report.audience_label}`}
          </Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.customerName}>{report.customer_name}</Text>
          {report.property_address ? <Text style={styles.sub}>{report.property_address}</Text> : null}
          <Text style={styles.sub}>
            {report.equipment_label}
            {report.equipment_serial ? ` · S/N ${report.equipment_serial}` : ""}
          </Text>

          <View style={styles.summaryRow}>
            {(
              [
                ["Pass", report.summary.pass],
                ["Fail", report.summary.fail],
                ["N/A", report.summary.na],
              ] as const
            ).map(([label, value]) => (
              <View key={label} style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>{label.toUpperCase()}</Text>
                <Text style={styles.summaryValue}>{value}</Text>
              </View>
            ))}
          </View>

          {report.failures.length > 0 && (
            <View style={styles.callout}>
              <Text style={{ fontSize: 8, fontWeight: 700, color: colors.accent }}>FAILURES AND RECOMMENDATIONS</Text>
              {report.failures.map((item) => (
                <Text key={item.key} style={{ fontSize: 8, marginTop: 3 }}>
                  {item.section} — {item.label}
                  {item.notes ? `: ${item.notes}` : ""}
                  {item.readings.length
                    ? ` (${item.readings.map((reading) => `${reading.label} ${reading.value}${reading.unit ? ` ${reading.unit}` : ""}`).join(", ")})`
                    : ""}
                </Text>
              ))}
              {report.recommendations ? <Text style={{ fontSize: 8, marginTop: 4 }}>{report.recommendations}</Text> : null}
            </View>
          )}

          {report.failures.length === 0 && report.recommendations ? (
            <View style={styles.row}>
              <Text style={{ fontSize: 8, fontWeight: 700, color: colors.navy }}>RECOMMENDATIONS</Text>
              <Text style={styles.notes}>{report.recommendations}</Text>
            </View>
          ) : null}

          {report.sections.map((section) => (
            <View key={section.name}>
              <Text style={styles.sectionLabel}>{section.name.toUpperCase()}</Text>
              {section.items.map((item) => (
                <View key={item.key} style={item.result === "fail" ? styles.failRow : styles.row} wrap={false}>
                  <View style={styles.rowTop}>
                    <Text style={styles.itemLabel}>{item.label}</Text>
                    <Text style={{ ...styles.result, color: resultColor(item.result) }}>{resultLabel(item.result)}</Text>
                  </View>
                  {item.readings.length > 0 && (
                    <Text style={styles.readings}>
                      {item.readings
                        .map((reading) => `${reading.label}: ${reading.value}${reading.unit ? ` ${reading.unit}` : ""}`)
                        .join("   ·   ")}
                    </Text>
                  )}
                  {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}
                </View>
              ))}
            </View>
          ))}

          {photos.length > 0 && (
            <View>
              <Text style={styles.sectionLabel}>PHOTOS</Text>
              <View style={styles.photoGrid}>
                {photos.map((photo, index) =>
                  photo.url ? <Image key={`${photo.label}-${index}`} src={photo.url} style={styles.photo} /> : null
                )}
              </View>
            </View>
          )}
        </View>

        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${COMPANY_NAME} · ${COMPANY_PHONE_DISPLAY} · ${COMPANY_EMAIL} · Page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

export function renderPmReportPdf(report: PmReportModel): Promise<Buffer> {
  return renderToBuffer(<PmReportPdf report={report} />);
}
