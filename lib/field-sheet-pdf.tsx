import path from "path";
import { readFile } from "fs/promises";
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { COMPANY_SLOGAN } from "@/lib/brand";
import { registerBrandFonts, BODY_FONT, DISPLAY_FONT } from "@/lib/pdf-fonts";
import type { FieldSheetLine, FieldSheetPayload } from "@/lib/field-sheet";

registerBrandFonts();

const colors = {
  navy: "#0a1628",
  accent: "#e8502a",
  brand: "#38b7e1",
  off: "#f4f6fa",
  line: "#e2e8f0",
  g500: "#64748b",
  g700: "#334155",
  white: "#ffffff",
};

let logoDataUri: string | null = null;
async function getLogoDataUri() {
  if (logoDataUri) return logoDataUri;
  try {
    const buffer = await readFile(path.join(process.cwd(), "public", "logo-mark.png"));
    logoDataUri = `data:image/png;base64,${buffer.toString("base64")}`;
    return logoDataUri;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  page: { fontFamily: BODY_FONT, fontSize: 9, color: colors.g700, paddingBottom: 36 },
  topBar: { height: 4, backgroundColor: colors.accent },
  header: {
    backgroundColor: colors.navy,
    paddingHorizontal: 22,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 48, height: 40 },
  company: { color: colors.white, fontFamily: DISPLAY_FONT, fontSize: 14, fontWeight: 700 },
  slogan: { color: colors.brand, fontSize: 7, marginTop: 3, letterSpacing: 0.3 },
  sheetTitle: { color: colors.white, fontSize: 8, marginTop: 4, letterSpacing: 1 },
  date: { color: colors.white, fontSize: 11, fontWeight: 700, textAlign: "right" },
  meta: { color: "#94a3b8", fontSize: 8, textAlign: "right", marginTop: 2 },
  body: { paddingHorizontal: 18, paddingTop: 12 },
  notes: { borderWidth: 1, borderColor: colors.line, marginBottom: 8, minHeight: 52 },
  sectionTitle: {
    backgroundColor: colors.navy,
    color: colors.white,
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 1,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  sectionBody: { padding: 8, minHeight: 28 },
  noteLine: { fontSize: 8, marginBottom: 3 },
  grid: { flexDirection: "row", gap: 8, marginBottom: 8 },
  col: { flex: 1, borderWidth: 1, borderColor: colors.line, minHeight: 92 },
  row: { marginBottom: 5 },
  label: { fontSize: 8, fontWeight: 700, color: colors.navy },
  detail: { fontSize: 7.5, color: colors.g500, marginTop: 1 },
  blank: { borderBottomWidth: 0.6, borderBottomColor: colors.line, marginTop: 8, height: 10 },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.navy,
    paddingHorizontal: 18,
    paddingVertical: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { color: "#94a3b8", fontSize: 7 },
});

function Block({ title, items, blanks = 3 }: { title: string; items: FieldSheetLine[]; blanks?: number }) {
  return (
    <View style={styles.col}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>
        {items.length === 0 ? <Text style={styles.detail}>None on the board.</Text> : null}
        {items.map((item) => (
          <View key={item.id} style={styles.row} wrap={false}>
            <Text style={styles.label}>
              {item.label}
              {item.stamp ? `  ·  ${item.stamp}` : ""}
            </Text>
            {item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
          </View>
        ))}
        {Array.from({ length: blanks }).map((_, i) => (
          <View key={`b-${title}-${i}`} style={styles.blank} />
        ))}
      </View>
    </View>
  );
}

export function FieldSheetPdf({ sheet, logo }: { sheet: FieldSheetPayload; logo: string | null }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.topBar} />
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {logo ? <Image src={logo} style={styles.logo} /> : null}
            <View>
              <Text style={styles.company}>EAST COAST MECHANICAL</Text>
              <Text style={styles.slogan}>{COMPANY_SLOGAN}</Text>
              <Text style={styles.sheetTitle}>DAILY FIELD SHEET</Text>
            </View>
          </View>
          <View>
            <Text style={styles.date}>{sheet.dateLabel}</Text>
            <Text style={styles.meta}>Josh Crowley  ·  CRM live</Text>
          </View>
        </View>
        <View style={styles.body}>
          <View style={styles.notes}>
            <Text style={styles.sectionTitle}>NOTES</Text>
            <View style={styles.sectionBody}>
              {sheet.notes.map((note, i) => (
                <Text key={i} style={styles.noteLine}>
                  {note}
                </Text>
              ))}
              <View style={styles.blank} />
              <View style={styles.blank} />
            </View>
          </View>
          <View style={styles.grid}>
            <Block title="ACTIVE" items={sheet.active} />
            <Block title="ONGOING" items={sheet.ongoing} />
          </View>
          <View style={styles.grid}>
            <Block title="TASK" items={sheet.tasks} />
            <Block title="TO BILL" items={sheet.toBill} />
          </View>
          <View style={styles.grid}>
            <Block title="TO CONTACT" items={sheet.toContact} />
            <Block title="LEFTOVER" items={sheet.leftover} />
          </View>
        </View>
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>(774) 343-6369  ·  eastcoastmechanical.org</Text>
          <Text style={styles.footerText}>From CRM Field Board</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderFieldSheetPdf(sheet: FieldSheetPayload): Promise<Buffer> {
  const logo = await getLogoDataUri();
  return renderToBuffer(<FieldSheetPdf sheet={sheet} logo={logo} />);
}
