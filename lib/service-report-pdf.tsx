import { Document, Page, View, Text, Image, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import { COMPANY_SLOGAN } from "./brand";

export type ServiceReportReadings = {
  outdoor_temp: number | null;
  indoor_temp: number | null;
  supply_air_temp: number | null;
  return_air_temp: number | null;
  indoor_rh: number | null;
  suction_pressure: number | null;
  liquid_pressure: number | null;
  suction_line_temp: number | null;
  liquid_line_temp: number | null;
  discharge_pressure: number | null;
  discharge_temp: number | null;
  amp_draw: number | null;
  voltage: number | null;
  refrigerant: string | null;
  superheat: number | null;
  subcooling: number | null;
  temp_split: number | null;
  symptoms: string;
};

export type ServiceReportLineItem = {
  price_book_item_name: string | null;
  description: string;
  qty: number;
  unit: string;
  notes: string | null;
};

export type ServiceReportPhoto = { url: string; caption: string | null };

export type ServiceReportPdfData = {
  doc_number: string | null;
  created_at: string;
  customer_name: string;
  property_address: string | null;
  equipment_label: string;
  equipment_serial: string | null;
  readings: ServiceReportReadings;
  ai_diagnosis: string | null;
  suggested_fix: string | null;
  suggested_line_items: ServiceReportLineItem[];
  photos: ServiceReportPhoto[];
};

Font.registerHyphenationCallback((word) => [word]);

const colors = {
  navy: "#0a1628",
  accent: "#e8502a",
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
  companyName: { color: "#ffffff", fontSize: 16, fontWeight: 700 },
  companyTag: { color: colors.g300, fontSize: 8, letterSpacing: 1, marginTop: 2 },
  docTitle: { color: colors.accent, fontSize: 14, fontWeight: 700, textAlign: "right" },
  docMeta: { color: colors.g300, fontSize: 8, textAlign: "right", marginTop: 2 },
  body: { paddingHorizontal: 32, paddingTop: 20 },
  customerBlock: { marginBottom: 14 },
  customerName: { fontSize: 11, fontWeight: 700, color: colors.navy },
  customerSub: { fontSize: 9, color: colors.g700, marginTop: 2 },
  sectionLabel: {
    fontSize: 7.5,
    fontWeight: 700,
    color: colors.g300,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  section: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    padding: 10,
    marginBottom: 12,
  },
  sectionAccent: {
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: "#fdf1ee",
    borderRadius: 4,
    padding: 10,
    marginBottom: 12,
  },
  bodyText: { fontSize: 9, lineHeight: 1.4, color: colors.g700 },
  calloutRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  calloutCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    padding: 8,
    textAlign: "center",
  },
  calloutValue: { fontSize: 13, fontWeight: 700, color: colors.navy, marginTop: 2 },
  readingsGrid: { flexDirection: "row", flexWrap: "wrap" },
  readingCell: { width: "50%", fontSize: 8.5, marginBottom: 3, color: colors.g700 },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: 4 },
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
  th: { fontSize: 7, fontWeight: 700, color: colors.g300, letterSpacing: 0.5, paddingHorizontal: 6 },
  td: { fontSize: 8.5, paddingHorizontal: 6 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photo: { width: 150, height: 112, borderRadius: 4, objectFit: "cover" },
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

function fmt(value: number | null, unit: string) {
  return value === null ? "—" : `${value}${unit}`;
}

export function ServiceReportPdf({ doc }: { doc: ServiceReportPdfData }) {
  const r = doc.readings;

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.companyName}>East Coast Mechanical</Text>
            <Text style={styles.companyTag}>{COMPANY_SLOGAN}</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>{doc.doc_number ?? ""} — Service Report</Text>
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
            <Text style={styles.customerSub}>
              {doc.equipment_label}
              {doc.equipment_serial ? ` · S/N ${doc.equipment_serial}` : ""}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>SYMPTOMS REPORTED</Text>
            <Text style={styles.bodyText}>{r.symptoms}</Text>
          </View>

          <View style={styles.calloutRow}>
            <View style={styles.calloutCard}>
              <Text style={styles.sectionLabel}>SUPERHEAT</Text>
              <Text style={styles.calloutValue}>{fmt(r.superheat, "°F")}</Text>
            </View>
            <View style={styles.calloutCard}>
              <Text style={styles.sectionLabel}>SUBCOOLING</Text>
              <Text style={styles.calloutValue}>{fmt(r.subcooling, "°F")}</Text>
            </View>
            <View style={styles.calloutCard}>
              <Text style={styles.sectionLabel}>TEMP SPLIT</Text>
              <Text style={styles.calloutValue}>{fmt(r.temp_split, "°F")}</Text>
            </View>
          </View>

          <View style={styles.sectionAccent}>
            <Text style={{ ...styles.sectionLabel, color: colors.accent }}>AI DIAGNOSIS</Text>
            <Text style={styles.bodyText}>{doc.ai_diagnosis}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>SUGGESTED FIX</Text>
            <Text style={styles.bodyText}>{doc.suggested_fix}</Text>
          </View>

          {doc.suggested_line_items.length > 0 && (
            <View style={{ ...styles.table, marginBottom: 12 }}>
              <View style={styles.tableHeaderRow}>
                <Text style={{ ...styles.th, width: "70%" }}>DESCRIPTION</Text>
                <Text style={{ ...styles.th, width: "30%" }}>QTY</Text>
              </View>
              {doc.suggested_line_items.map((item, i) => (
                <View
                  key={i}
                  style={
                    i === doc.suggested_line_items.length - 1
                      ? { ...styles.tableRow, borderBottomWidth: 0 }
                      : styles.tableRow
                  }
                  wrap={false}
                >
                  <View style={{ ...styles.td, width: "70%" }}>
                    <Text>{item.description}</Text>
                    {item.notes && <Text style={{ fontSize: 7, color: colors.g300, marginTop: 1 }}>{item.notes}</Text>}
                  </View>
                  <Text style={{ ...styles.td, width: "30%" }}>
                    {item.qty} {item.unit}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>READINGS</Text>
            <View style={styles.readingsGrid}>
              <Text style={styles.readingCell}>Refrigerant: {r.refrigerant ?? "—"}</Text>
              <Text style={styles.readingCell}>Outdoor temp: {fmt(r.outdoor_temp, "°F")}</Text>
              <Text style={styles.readingCell}>Indoor temp: {fmt(r.indoor_temp, "°F")}</Text>
              <Text style={styles.readingCell}>Supply air: {fmt(r.supply_air_temp, "°F")}</Text>
              <Text style={styles.readingCell}>Return air: {fmt(r.return_air_temp, "°F")}</Text>
              <Text style={styles.readingCell}>Indoor RH: {fmt(r.indoor_rh, "%")}</Text>
              <Text style={styles.readingCell}>Suction pressure: {fmt(r.suction_pressure, " PSIG")}</Text>
              <Text style={styles.readingCell}>Liquid pressure: {fmt(r.liquid_pressure, " PSIG")}</Text>
              <Text style={styles.readingCell}>Suction line temp: {fmt(r.suction_line_temp, "°F")}</Text>
              <Text style={styles.readingCell}>Liquid line temp: {fmt(r.liquid_line_temp, "°F")}</Text>
              <Text style={styles.readingCell}>Discharge pressure: {fmt(r.discharge_pressure, " PSIG")}</Text>
              <Text style={styles.readingCell}>Discharge temp: {fmt(r.discharge_temp, "°F")}</Text>
              <Text style={styles.readingCell}>Amp draw: {fmt(r.amp_draw, "A")}</Text>
              <Text style={styles.readingCell}>Voltage: {fmt(r.voltage, "V")}</Text>
            </View>
          </View>

          {doc.photos.length > 0 && (
            <View style={{ marginBottom: 12 }} wrap={false}>
              <Text style={styles.sectionLabel}>PHOTOS</Text>
              <View style={styles.photoGrid}>
                {doc.photos.map((photo, i) => (
                  <Image key={i} src={photo.url} style={styles.photo} />
                ))}
              </View>
            </View>
          )}
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

export async function renderServiceReportPdf(doc: ServiceReportPdfData): Promise<Buffer> {
  return renderToBuffer(<ServiceReportPdf doc={doc} />);
}
