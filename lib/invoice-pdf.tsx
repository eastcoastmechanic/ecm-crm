import { Document, Page, View, Text, Image, StyleSheet, Link } from "@react-pdf/renderer";
import {
  COMPANY_ADDRESS,
  COMPANY_NAME,
  COMPANY_PHONE_DISPLAY,
  COMPANY_SLOGAN,
  COMPANY_WEBSITE,
  companyLicenseLine,
} from "./brand";
import { BODY_FONT, DISPLAY_FONT } from "./pdf-fonts";
import { colors } from "./pdf-brand";
import { formatEtDate } from "@/lib/tz";
import { depositSentence, formatCents, isPastDue, type InvoiceExtras } from "./invoice-view";
import type { PdfDocumentData } from "./pdf";

export type InvoicePdfExtras = InvoiceExtras;

const longDate = { year: "numeric", month: "long", day: "numeric" } as const;

const s = StyleSheet.create({
  page: { fontFamily: BODY_FONT, fontSize: 9, color: colors.g700, paddingBottom: 64 },
  topBar: { height: 5, backgroundColor: colors.accent },
  header: {
    backgroundColor: colors.navy,
    paddingHorizontal: 32,
    paddingVertical: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 52, height: 44 },
  companyName: { color: colors.white, fontFamily: DISPLAY_FONT, fontSize: 16, fontWeight: 700, letterSpacing: 0.75 },
  companyTag: { color: colors.brand, fontSize: 8, fontWeight: 600, letterSpacing: 0.3, marginTop: 3 },
  companyContact: { color: colors.g300, fontSize: 7.5, marginTop: 4 },
  headerRight: { alignItems: "flex-end" },
  title: { color: colors.white, fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 700, letterSpacing: 2 },
  docNumber: { color: colors.brand, fontSize: 11, fontWeight: 700, marginTop: 4 },

  body: { paddingHorizontal: 32, paddingTop: 20 },

  infoRow: { flexDirection: "row", gap: 14, marginBottom: 18 },
  infoCol: { flex: 1 },
  label: { fontSize: 7, fontWeight: 700, color: colors.highlight, letterSpacing: 1.5, marginBottom: 4 },
  strong: { fontSize: 10.5, fontWeight: 700, color: colors.navy },
  sub: { fontSize: 8.5, color: colors.g500, marginTop: 2, lineHeight: 1.35 },
  metaBox: { width: 190, backgroundColor: colors.off, borderRadius: 5, paddingVertical: 8, paddingHorizontal: 10 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  metaKey: { fontSize: 8, color: colors.g500 },
  metaVal: { fontSize: 8.5, fontWeight: 700, color: colors.navy, textAlign: "right", maxWidth: 120 },
  metaValDue: { color: colors.accent2 },
  pastDue: {
    alignSelf: "flex-end",
    marginTop: 4,
    backgroundColor: colors.red,
    color: colors.white,
    fontSize: 7,
    fontWeight: 700,
    letterSpacing: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },

  table: { borderRadius: 5, overflow: "hidden", borderWidth: 1, borderColor: colors.g100 },
  thRow: { flexDirection: "row", backgroundColor: colors.navy, paddingVertical: 7 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.g100, paddingVertical: 7 },
  trAlt: { backgroundColor: colors.off },
  th: { fontSize: 7, fontWeight: 700, color: colors.white, letterSpacing: 0.5, paddingHorizontal: 8 },
  td: { fontSize: 8.5, paddingHorizontal: 8 },
  cDesc: { width: "52%" },
  cQty: { width: "12%", textAlign: "center" },
  cUnit: { width: "18%", textAlign: "right" },
  cAmt: { width: "18%", textAlign: "right" },
  descTitle: { fontWeight: 700, color: colors.navy },
  descSub: { fontSize: 7, color: colors.g500, marginTop: 1.5 },
  amt: { fontWeight: 700, color: colors.navy },

  lower: { flexDirection: "row", gap: 16, marginTop: 14 },
  lowerLeft: { flex: 1 },
  totals: { width: 220 },
  totRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, paddingHorizontal: 4 },
  totKey: { fontSize: 8.5, color: colors.g500 },
  totVal: { fontSize: 8.5, color: colors.navy, fontWeight: 500 },
  totRule: { borderTopWidth: 1, borderTopColor: colors.g100, marginVertical: 3 },
  dueBox: {
    marginTop: 6,
    backgroundColor: colors.accent,
    borderRadius: 5,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  dueBoxPaid: { backgroundColor: colors.green },
  dueLabel: { color: colors.white, fontSize: 8, fontWeight: 700, letterSpacing: 1.2 },
  dueAmount: { color: colors.white, fontSize: 22, fontWeight: 700, marginTop: 2 },
  dueSub: { color: colors.white, fontSize: 7.5, marginTop: 2 },

  card: { borderRadius: 5, borderWidth: 1, borderColor: colors.g100, padding: 10, marginBottom: 10 },
  cardTitle: { fontSize: 7.5, fontWeight: 700, color: colors.navy, letterSpacing: 1, marginBottom: 4 },
  cardText: { fontSize: 8.5, color: colors.g700, lineHeight: 1.45 },
  link: { color: colors.highlight, textDecoration: "none", fontWeight: 700 },
  depositCard: { borderLeftWidth: 3, borderLeftColor: colors.green },

  // In the page flow beside the totals (not pinned over the page), so it never covers text.
  paidRow: { flexDirection: "row", alignItems: "center", gap: 18, paddingVertical: 10, paddingLeft: 10 },
  stamp: {
    borderWidth: 3,
    borderColor: colors.green,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 14,
    transform: "rotate(-14deg)",
    opacity: 0.85,
    alignItems: "center",
  },
  stampText: { color: colors.green, fontFamily: DISPLAY_FONT, fontSize: 30, fontWeight: 700, letterSpacing: 3 },
  stampSub: { color: colors.green, fontSize: 8, fontWeight: 700, letterSpacing: 0.5 },

  photoSection: { marginTop: 14 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoCell: { width: 150 },
  photo: { width: 150, height: 112, borderRadius: 4, objectFit: "cover" },
  photoCaption: { marginTop: 3, fontSize: 7, color: colors.g300 },

  terms: { marginTop: 16, fontSize: 7.5, color: colors.g500, lineHeight: 1.45, textAlign: "center" },
  thanks: { marginTop: 6, fontSize: 9, fontWeight: 700, color: colors.navy, textAlign: "center" },

  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.navy2,
    paddingHorizontal: 32,
    paddingVertical: 10,
  },
  footerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footerText: { fontSize: 7.5, color: colors.g300 },
  footerLicense: { fontSize: 6.5, color: colors.g500, marginTop: 2 },
});

function dateLabel(value: string): string {
  return formatEtDate(value, longDate);
}

export function InvoicePdf({ doc, invoice, logo }: { doc: PdfDocumentData; invoice: InvoicePdfExtras; logo: string | null }) {
  const { view, billTo } = invoice;
  const pastDue = isPastDue(view, invoice.dueDate, invoice.todayKey);
  const license = companyLicenseLine();
  const portalLabel = invoice.portalUrl.replace(/^https?:\/\//, "");
  const num = doc.doc_number ?? "";

  return (
    <Document title={`Invoice ${num}`} author={COMPANY_NAME}>
      <Page size="LETTER" style={s.page}>
        <View style={s.topBar} fixed />
        <View style={s.header} fixed>
          <View style={s.headerLeft}>
            {logo && <Image src={logo} style={s.logo} />}
            <View>
              <Text style={s.companyName}>EAST COAST MECHANICAL</Text>
              <Text style={s.companyTag}>{COMPANY_SLOGAN}</Text>
              <Text style={s.companyContact}>
                {COMPANY_ADDRESS}  ·  {COMPANY_PHONE_DISPLAY}  ·  {COMPANY_WEBSITE}
              </Text>
            </View>
          </View>
          <View style={s.headerRight}>
            <Text style={s.title}>INVOICE</Text>
            <Text style={s.docNumber}>{num}</Text>
          </View>
        </View>

        <View style={s.body}>
          <View style={s.infoRow}>
            <View style={s.infoCol}>
              <Text style={s.label}>BILL TO</Text>
              <Text style={s.strong}>{billTo.name}</Text>
              {billTo.company && <Text style={s.sub}>{billTo.company}</Text>}
              {billTo.address && <Text style={s.sub}>{billTo.address}</Text>}
              {billTo.email && <Text style={s.sub}>{billTo.email}</Text>}
              {billTo.phone && <Text style={s.sub}>{billTo.phone}</Text>}
            </View>
            <View style={s.infoCol}>
              <Text style={s.label}>SERVICE ADDRESS</Text>
              <Text style={{ ...s.sub, marginTop: 0, color: colors.navy, fontSize: 9.5 }}>
                {doc.property_address ?? billTo.address ?? "—"}
              </Text>
              {invoice.jobRef && (
                <>
                  <Text style={{ ...s.label, marginTop: 10 }}>JOB</Text>
                  <Text style={{ ...s.sub, marginTop: 0 }}>{invoice.jobRef}</Text>
                </>
              )}
            </View>
            <View style={s.metaBox}>
              <View style={s.metaRow}>
                <Text style={s.metaKey}>Invoice #</Text>
                <Text style={s.metaVal}>{num || "—"}</Text>
              </View>
              <View style={s.metaRow}>
                <Text style={s.metaKey}>Issued</Text>
                <Text style={s.metaVal}>{dateLabel(invoice.issueDate)}</Text>
              </View>
              <View style={s.metaRow}>
                <Text style={s.metaKey}>Due</Text>
                <Text style={{ ...s.metaVal, ...(view.paid ? {} : s.metaValDue) }}>
                  {invoice.dueDate ? dateLabel(invoice.dueDate) : "Net 30"}
                </Text>
              </View>
              <View style={s.metaRow}>
                <Text style={s.metaKey}>{view.paid ? "Status" : "Amount due"}</Text>
                <Text style={s.metaVal}>{view.paid ? "Paid" : formatCents(view.balanceDueCents)}</Text>
              </View>
              {pastDue && <Text style={s.pastDue}>PAST DUE</Text>}
            </View>
          </View>

          <View style={s.table}>
            <View style={s.thRow} fixed>
              <Text style={{ ...s.th, ...s.cDesc }}>DESCRIPTION</Text>
              <Text style={{ ...s.th, ...s.cQty }}>QTY</Text>
              <Text style={{ ...s.th, ...s.cUnit }}>UNIT PRICE</Text>
              <Text style={{ ...s.th, ...s.cAmt }}>AMOUNT</Text>
            </View>
            {view.lines.map((line, i) => (
              <View
                key={i}
                wrap={false}
                style={{
                  ...s.tr,
                  ...(i % 2 === 1 ? s.trAlt : {}),
                  ...(i === view.lines.length - 1 ? { borderBottomWidth: 0 } : {}),
                }}
              >
                <View style={{ ...s.td, ...s.cDesc }}>
                  <Text style={s.descTitle}>{line.description}</Text>
                  {line.detail && <Text style={s.descSub}>{line.detail}</Text>}
                </View>
                <Text style={{ ...s.td, ...s.cQty }}>{line.qtyLabel}</Text>
                <Text style={{ ...s.td, ...s.cUnit }}>{line.unitCents == null ? "—" : formatCents(line.unitCents)}</Text>
                <Text style={{ ...s.td, ...s.cAmt, ...s.amt }}>
                  {line.amountCents == null ? "—" : formatCents(line.amountCents)}
                </Text>
              </View>
            ))}
          </View>

          <View style={s.lower} wrap={false}>
            <View style={s.lowerLeft}>
              {view.deposit && (
                <View style={{ ...s.card, ...s.depositCard }}>
                  <Text style={s.cardTitle}>DEPOSIT ALREADY RECEIVED</Text>
                  <Text style={s.cardText}>
                    {depositSentence(view.deposit)}
                  </Text>
                </View>
              )}
              {view.paid ? (
                <View style={s.paidRow}>
                  <View style={s.stamp}>
                    <Text style={s.stampText}>PAID</Text>
                    {invoice.paidAt && <Text style={s.stampSub}>{dateLabel(invoice.paidAt).toUpperCase()}</Text>}
                  </View>
                  <Text style={{ ...s.cardText, flex: 1 }}>Paid in full. Thank you. Keep this copy for your records.</Text>
                </View>
              ) : (
                <View style={s.card}>
                  <Text style={s.cardTitle}>PAY ONLINE</Text>
                  <Text style={s.cardText}>
                    Pay by card: sign in at{" "}
                    <Link src={invoice.portalUrl} style={s.link}>
                      {portalLabel}
                    </Link>{" "}
                    with your email address and open invoice {num}, or press Pay invoice in our invoice email. To pay
                    another way, call {COMPANY_PHONE_DISPLAY}.
                  </Text>
                </View>
              )}
            </View>

            <View style={s.totals}>
              <View style={s.totRow}>
                <Text style={s.totKey}>Subtotal</Text>
                <Text style={s.totVal}>{formatCents(view.subtotalCents)}</Text>
              </View>
              {view.taxCents > 0 && (
                <View style={s.totRow}>
                  <Text style={s.totKey}>Tax</Text>
                  <Text style={s.totVal}>{formatCents(view.taxCents)}</Text>
                </View>
              )}
              <View style={s.totRule} />
              <View style={s.totRow}>
                <Text style={{ ...s.totKey, color: colors.navy, fontWeight: 700 }}>Invoice total</Text>
                <Text style={{ ...s.totVal, fontWeight: 700 }}>{formatCents(view.totalCents)}</Text>
              </View>
              {view.paid && (
                <View style={s.totRow}>
                  <Text style={s.totKey}>Paid</Text>
                  <Text style={s.totVal}>-{formatCents(view.totalCents)}</Text>
                </View>
              )}
              <View style={{ ...s.dueBox, ...(view.paid ? s.dueBoxPaid : {}) }}>
                <Text style={s.dueLabel}>BALANCE DUE</Text>
                <Text style={s.dueAmount}>{formatCents(view.balanceDueCents)}</Text>
                {!view.paid && invoice.dueDate && <Text style={s.dueSub}>Due by {dateLabel(invoice.dueDate)}</Text>}
              </View>
            </View>
          </View>

          {doc.photos?.some((p) => p.url) && (
            <View style={s.photoSection} wrap={false}>
              <Text style={s.label}>JOB PHOTOS</Text>
              <View style={s.photoGrid}>
                {doc.photos.map((photo, i) =>
                  // A missing object must not take the document down with it:
                  // @react-pdf throws on an unfetchable src.
                  photo.url ? (
                    <View key={i} style={s.photoCell}>
                      <Image src={photo.url} style={s.photo} />
                      {photo.caption && <Text style={s.photoCaption}>{photo.caption}</Text>}
                    </View>
                  ) : null
                )}
              </View>
            </View>
          )}

          <Text style={s.terms}>
            {view.paid
              ? `This invoice is paid in full. Questions? Call ${COMPANY_PHONE_DISPLAY} or reply to the invoice email.`
              : `Payment is due by the due date shown above. Questions about this invoice? Call ${COMPANY_PHONE_DISPLAY} or reply to the invoice email.`}
          </Text>
          <Text style={s.thanks}>Thank you for choosing East Coast Mechanical.</Text>
        </View>

        <View style={s.footer} fixed>
          <View style={s.footerRow}>
            <Text style={s.footerText}>
              {COMPANY_NAME}  ·  {COMPANY_PHONE_DISPLAY}  ·  {COMPANY_WEBSITE}
            </Text>
            <Text
              style={s.footerText}
              render={({ pageNumber, totalPages }) => `Invoice ${num}  ·  Page ${pageNumber} of ${totalPages}`}
            />
          </View>
          {license ? <Text style={s.footerLicense}>{license}</Text> : null}
        </View>
      </Page>
    </Document>
  );
}
