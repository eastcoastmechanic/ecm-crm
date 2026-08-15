import { Document, Page, View, Text, Image, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import { COMPANY_NAME, COMPANY_SLOGAN, COMPANY_ADDRESS, COMPANY_PHONE, HIC_REGISTRATION_NUMBER } from "./brand";
import { RIGHT_TO_CANCEL_NOTICE, ARBITRATION_NOTICE_TEXT, GOVERNING_TERMS_TEXT, noticeOfCancellationText } from "./contract-terms";
import { registerBrandFonts, BODY_FONT, DISPLAY_FONT } from "./pdf-fonts";

export type ContractPdfData = {
  doc_number: string | null;
  created_at: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  property_address: string | null;
  scope_of_work: string;
  payment_terms: string;
  warranty_terms: string;
  start_date: string | null;
  estimated_completion: string | null;
  notes: string | null;
  total: number | null;
  status: string;
  signed_at: string | null;
  signature_data: string | null;
};

Font.registerHyphenationCallback((word) => [word]);

registerBrandFonts();

const colors = {
  navy: "#0a1628",
  brand: "#38b7e1",
  accent: "#e8502a",
  g300: "#94a3b8",
  g700: "#334155",
  border: "#e2e8f0",
  green: "#16a34a",
  warnBg: "#fdf1ee",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatPrice(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

const styles = StyleSheet.create({
  page: { fontFamily: BODY_FONT, fontSize: 9, color: colors.g700, paddingBottom: 48 },
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
  partiesRow: { flexDirection: "row", gap: 16, marginBottom: 14 },
  partyBlock: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 4, padding: 10 },
  sectionLabel: {
    fontSize: 7.5,
    fontFamily: BODY_FONT,
    fontWeight: 700,
    color: colors.g300,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  partyName: { fontFamily: BODY_FONT, fontSize: 11, fontWeight: 700, color: colors.navy },
  partyLine: { fontSize: 8.5, color: colors.g700, marginTop: 2 },
  warn: { color: colors.accent, fontWeight: 700 },
  section: { marginBottom: 14 },
  sectionTitle: {
    fontFamily: BODY_FONT,
    fontSize: 10,
    fontWeight: 700,
    color: colors.navy,
    marginBottom: 4,
  },
  bodyText: { fontSize: 8.5, color: colors.g700, lineHeight: 1.5 },
  priceCard: {
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: "#eaf7fc",
    borderRadius: 4,
    padding: 10,
    marginBottom: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  priceLabel: { fontSize: 8, color: colors.g300, textTransform: "uppercase" },
  priceValue: { fontFamily: DISPLAY_FONT, fontSize: 18, fontWeight: 700, color: colors.navy },
  noticeBox: {
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.warnBg,
    borderRadius: 4,
    padding: 10,
    marginBottom: 14,
  },
  noticeTitle: { fontSize: 9, fontFamily: BODY_FONT, fontWeight: 700, color: colors.accent, marginBottom: 3 },
  signatureBlock: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: "row", gap: 24 },
  signatureCol: { flex: 1 },
  signatureImg: { width: 160, height: 48, objectFit: "contain", marginBottom: 4 },
  signatureLine: { borderTopWidth: 1, borderTopColor: colors.g700, width: 160, marginTop: 30, paddingTop: 3 },
  signatureLabel: { fontSize: 7.5, color: colors.g300 },
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

export function ContractPdf({ doc }: { doc: ContractPdfData }) {
  const transactionDate = formatDate(doc.created_at);

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.companyName}>{COMPANY_NAME}</Text>
            <Text style={styles.companyTag}>{COMPANY_SLOGAN}</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>{doc.doc_number ?? ""} — Service Contract</Text>
            <Text style={styles.docMeta}>{transactionDate}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.partiesRow}>
            <View style={styles.partyBlock}>
              <Text style={styles.sectionLabel}>CONTRACTOR</Text>
              <Text style={styles.partyName}>{COMPANY_NAME}</Text>
              <Text style={styles.partyLine}>
                {COMPANY_ADDRESS || <Text style={styles.warn}>ADDRESS NOT SET — see lib/brand.ts</Text>}
              </Text>
              <Text style={styles.partyLine}>
                {COMPANY_PHONE || <Text style={styles.warn}>PHONE NOT SET — see lib/brand.ts</Text>}
              </Text>
              <Text style={styles.partyLine}>
                HIC Reg. #:{" "}
                {HIC_REGISTRATION_NUMBER || <Text style={styles.warn}>NOT SET — see lib/brand.ts</Text>}
              </Text>
            </View>
            <View style={styles.partyBlock}>
              <Text style={styles.sectionLabel}>CUSTOMER (OWNER)</Text>
              <Text style={styles.partyName}>{doc.customer_name}</Text>
              {doc.property_address && <Text style={styles.partyLine}>{doc.property_address}</Text>}
              {doc.customer_phone && <Text style={styles.partyLine}>{doc.customer_phone}</Text>}
              {doc.customer_email && <Text style={styles.partyLine}>{doc.customer_email}</Text>}
            </View>
          </View>

          <View style={styles.priceCard}>
            <View>
              <Text style={styles.priceLabel}>Contract Price</Text>
              <Text style={styles.priceValue}>{formatPrice(doc.total)}</Text>
            </View>
            <View style={{ maxWidth: 260 }}>
              <Text style={styles.sectionLabel}>PAYMENT TERMS</Text>
              <Text style={styles.bodyText}>{doc.payment_terms}</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Scope of Work</Text>
            <Text style={styles.bodyText}>{doc.scope_of_work}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Schedule</Text>
            <Text style={styles.bodyText}>
              Start date: {formatDate(doc.start_date)}
              {"   ·   "}
              Estimated completion: {formatDate(doc.estimated_completion)}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Warranty</Text>
            <Text style={styles.bodyText}>{doc.warranty_terms}</Text>
          </View>

          {doc.notes && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Additional Notes</Text>
              <Text style={styles.bodyText}>{doc.notes}</Text>
            </View>
          )}

          <View style={styles.noticeBox}>
            <Text style={styles.noticeTitle}>YOUR RIGHT TO CANCEL</Text>
            <Text style={styles.bodyText}>{RIGHT_TO_CANCEL_NOTICE}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Arbitration</Text>
            <Text style={styles.bodyText}>{ARBITRATION_NOTICE_TEXT}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>General Terms</Text>
            <Text style={styles.bodyText}>{GOVERNING_TERMS_TEXT}</Text>
          </View>

          <View style={styles.signatureBlock} wrap={false}>
            <View style={styles.signatureCol}>
              <Text style={styles.sectionLabel}>CONTRACTOR</Text>
              <Text style={styles.partyName}>{COMPANY_NAME}</Text>
              <Text style={styles.partyLine}>By issuing this contract, {COMPANY_NAME} agrees to the terms above.</Text>
            </View>
            <View style={styles.signatureCol}>
              <Text style={styles.sectionLabel}>CUSTOMER</Text>
              {doc.signature_data ? (
                <>
                  <Image src={doc.signature_data} style={styles.signatureImg} />
                  <Text style={styles.partyLine}>{doc.customer_name}</Text>
                  <Text style={styles.partyLine}>
                    Signed {doc.signed_at ? new Date(doc.signed_at).toLocaleString() : ""}
                  </Text>
                </>
              ) : (
                <View style={styles.signatureLine}>
                  <Text style={styles.signatureLabel}>Awaiting signature</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${COMPANY_NAME} · ${doc.doc_number ?? ""}  ·  Page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>

      <Page size="LETTER" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.companyName}>{COMPANY_NAME}</Text>
            <Text style={styles.companyTag}>{COMPANY_SLOGAN}</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>Notice of Cancellation</Text>
            <Text style={styles.docMeta}>Keep this page for your records</Text>
          </View>
        </View>
        <View style={styles.body}>
          <View style={styles.noticeBox}>
            <Text style={styles.bodyText}>{noticeOfCancellationText(transactionDate, doc.doc_number)}</Text>
          </View>
        </View>
        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${COMPANY_NAME} · ${doc.doc_number ?? ""}  ·  Page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

export async function renderContractPdf(doc: ContractPdfData): Promise<Buffer> {
  return renderToBuffer(<ContractPdf doc={doc} />);
}
