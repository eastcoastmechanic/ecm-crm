// The invoice email: branded HTML with a big Pay invoice button, plus a plain-text
// copy for mail apps that don't show HTML. Pure (no database, no Stripe): the caller
// passes the pay link it already made, so this file can't create a payment path.

import { COMPANY_ADDRESS, COMPANY_NAME, COMPANY_PHONE, COMPANY_PHONE_DISPLAY, COMPANY_SLOGAN, COMPANY_WEBSITE } from "@/lib/brand";
import { formatEtDate } from "@/lib/tz";
import { depositSentence, formatCents, isPastDue, type InvoiceView } from "@/lib/invoice-view";

export type InvoiceEmailInput = {
  customerName: string;
  docNumber: string | null;
  serviceAddress: string | null;
  view: InvoiceView;
  /** YYYY-MM-DD, New York calendar day. */
  dueDate: string | null;
  todayKey: string;
  /** The Stripe Checkout link made for this send (lib/payment-links.ts). Null when it couldn't be made or nothing is owed. */
  checkoutUrl: string | null;
  /** The customer portal, where Pay Now works any time. */
  portalUrl: string;
  /** Absolute URL of the logo for the email header. */
  logoUrl: string;
};

const longDate = { year: "numeric", month: "long", day: "numeric" } as const;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || "there";
}

export function invoiceEmailSubject(input: Pick<InvoiceEmailInput, "docNumber" | "view" | "dueDate">): string {
  const num = input.docNumber ? `Invoice ${input.docNumber}` : "Your invoice";
  if (input.view.paid) return `${num} from ${COMPANY_NAME}: paid, thank you`;
  const due = input.dueDate ? `, due ${formatEtDate(input.dueDate, longDate)}` : "";
  return `${num} from ${COMPANY_NAME}: ${formatCents(input.view.balanceDueCents)}${due}`;
}

/** The link the Pay invoice button opens: the fresh Stripe Checkout link if there is one, else the portal. */
export function payButtonUrl(input: Pick<InvoiceEmailInput, "checkoutUrl" | "portalUrl" | "view">): string | null {
  if (input.view.paid || input.view.balanceDueCents <= 0) return null;
  return input.checkoutUrl ?? input.portalUrl;
}

export function invoiceEmailText(input: InvoiceEmailInput): string {
  const { view } = input;
  const num = input.docNumber ?? "";
  const lines: string[] = [`Hi ${firstName(input.customerName)},`, ""];
  if (view.paid) {
    lines.push(`Here is a copy of invoice ${num}, paid in full. Thank you. The PDF is attached for your records.`);
  } else {
    lines.push(`Here is invoice ${num}${input.serviceAddress ? ` for the work at ${input.serviceAddress}` : ""}.`);
    lines.push("");
    lines.push(`Amount due: ${formatCents(view.balanceDueCents)}`);
    if (input.dueDate) lines.push(`Due by: ${formatEtDate(input.dueDate, longDate)}`);
    if (view.deposit) lines.push(depositSentence(view.deposit));
    lines.push("");
    const pay = payButtonUrl(input);
    if (pay && input.checkoutUrl) {
      lines.push(`Pay by card: ${pay}`);
      lines.push(`That link works for 24 hours. After that, pay any time at ${input.portalUrl} (sign in with this email address).`);
    } else if (pay) {
      lines.push(`Pay by card at ${input.portalUrl} (sign in with this email address and open invoice ${num}).`);
    }
    lines.push(`To pay another way, call ${COMPANY_PHONE_DISPLAY}.`);
    lines.push("");
    lines.push("The PDF invoice is attached.");
  }
  lines.push("", "Questions? Reply to this email or call us.", "", COMPANY_NAME, COMPANY_PHONE_DISPLAY, COMPANY_WEBSITE);
  return lines.join("\n");
}

const C = {
  navy: "#0a1628",
  accent: "#e8502a",
  brand: "#38b7e1",
  highlight: "#558ae7",
  off: "#f4f6fa",
  g100: "#e2e8f0",
  g500: "#64748b",
  g700: "#334155",
  green: "#16a34a",
  greenL: "#dcfce7",
  red: "#dc2626",
};

const FONT = "'DM Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function invoiceEmailHtml(input: InvoiceEmailInput): string {
  const { view } = input;
  const e = escapeHtml;
  const num = e(input.docNumber ?? "");
  const pay = payButtonUrl(input);
  const pastDue = isPastDue(view, input.dueDate, input.todayKey);
  const due = input.dueDate ? e(formatEtDate(input.dueDate, longDate)) : null;

  const lineRows = view.lines
    .map(
      (l) => `<tr>
  <td style="padding:10px 0;border-bottom:1px solid ${C.g100};font-size:14px;color:${C.navy};">
    <strong>${e(l.description)}</strong>${l.qtyLabel && l.qtyLabel !== "1" ? `<span style="color:${C.g500};"> &times; ${e(l.qtyLabel)}</span>` : ""}
    ${l.detail ? `<div style="font-size:12px;color:${C.g500};margin-top:2px;">${e(l.detail)}</div>` : ""}
  </td>
  <td align="right" style="padding:10px 0;border-bottom:1px solid ${C.g100};font-size:14px;color:${C.navy};white-space:nowrap;vertical-align:top;">${
        l.amountCents == null ? "&mdash;" : e(formatCents(l.amountCents))
      }</td>
</tr>`
    )
    .join("");

  const totalRow = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:4px 0;font-size:14px;color:${bold ? C.navy : C.g500};${bold ? "font-weight:700;" : ""}">${label}</td><td align="right" style="padding:4px 0;font-size:14px;color:${C.navy};${bold ? "font-weight:700;" : ""}">${value}</td></tr>`;

  const amountBox = view.paid
    ? `<td style="background:${C.greenL};border-radius:8px;padding:20px 24px;">
        <div style="font-size:12px;letter-spacing:1.5px;font-weight:700;color:${C.green};">PAID IN FULL</div>
        <div style="font-size:32px;font-weight:700;color:${C.green};margin-top:4px;">${e(formatCents(view.totalCents))}</div>
        <div style="font-size:14px;color:${C.g700};margin-top:6px;">Thank you. This copy is for your records.</div>
      </td>`
    : `<td style="background:${C.off};border-radius:8px;padding:20px 24px;border-left:4px solid ${C.accent};">
        <div style="font-size:12px;letter-spacing:1.5px;font-weight:700;color:${C.g500};">AMOUNT DUE${
          pastDue ? ` &nbsp;<span style="background:${C.red};color:#fff;border-radius:10px;padding:2px 8px;font-size:11px;">PAST DUE</span>` : ""
        }</div>
        <div style="font-size:36px;font-weight:700;color:${C.navy};margin-top:4px;">${e(formatCents(view.balanceDueCents))}</div>
        ${due ? `<div style="font-size:14px;color:${C.g700};margin-top:6px;">Due by <strong>${due}</strong></div>` : ""}
      </td>`;

  const button = pay
    ? `<tr><td align="center" style="padding:24px 0 8px;">
        <a href="${e(pay)}" style="display:inline-block;background:${C.accent};color:#ffffff;text-decoration:none;font-size:18px;font-weight:700;padding:16px 44px;border-radius:8px;">Pay invoice</a>
      </td></tr>
      <tr><td align="center" style="font-size:12px;color:${C.g500};padding:0 0 8px;line-height:1.5;">
        Secure card payment through Stripe.${
          input.checkoutUrl
            ? ` The button works for 24 hours. After that, pay any time at <a href="${e(input.portalUrl)}" style="color:${C.highlight};">${e(
                input.portalUrl.replace(/^https?:\/\//, "")
              )}</a> (sign in with this email address).`
            : ` Sign in with this email address and open invoice ${num}.`
        }
      </td></tr>`
    : "";

  const depositRow = view.deposit
    ? `<tr><td colspan="2" style="padding:8px 12px;margin-top:8px;background:${C.greenL};border-radius:6px;font-size:13px;color:${C.g700};">${e(
        depositSentence(view.deposit)
      )}</td></tr>`
    : "";

  const intro = view.paid
    ? `Here is a copy of invoice <strong>${num}</strong>, paid in full. Thank you for your business.`
    : `Here is invoice <strong>${num}</strong>${input.serviceAddress ? ` for the work at ${e(input.serviceAddress)}` : ""}. You can pay it online in a minute with the button below.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>Invoice ${num}</title>
</head>
<body style="margin:0;padding:0;background:${C.off};font-family:${FONT};color:${C.g700};">
<div style="display:none;max-height:0;overflow:hidden;">${e(invoiceEmailSubject(input))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.off};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;">
  <tr><td style="height:5px;background:${C.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td style="background:${C.navy};padding:20px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="60" style="vertical-align:middle;"><img src="${e(input.logoUrl)}" width="52" height="44" alt="ECM" style="display:block;border:0;"></td>
      <td style="vertical-align:middle;padding-left:10px;">
        <div style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:1px;">EAST COAST MECHANICAL</div>
        <div style="color:${C.brand};font-size:11px;font-weight:600;margin-top:3px;">${e(COMPANY_SLOGAN)}</div>
      </td>
      <td align="right" style="vertical-align:middle;color:#ffffff;font-size:13px;white-space:nowrap;">
        <div style="font-weight:700;letter-spacing:2px;">INVOICE</div>
        <div style="color:${C.brand};font-weight:700;margin-top:2px;">${num}</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:28px 28px 8px;">
    <p style="margin:0 0 12px;font-size:16px;color:${C.navy};">Hi ${e(firstName(input.customerName))},</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.55;">${intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${amountBox}</tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${button}</table>
  </td></tr>
  <tr><td style="padding:12px 28px 4px;">
    <div style="font-size:11px;letter-spacing:1.5px;font-weight:700;color:${C.highlight};margin-bottom:4px;">SUMMARY</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lineRows}</table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
      ${totalRow("Subtotal", e(formatCents(view.subtotalCents)))}
      ${view.taxCents > 0 ? totalRow("Tax", e(formatCents(view.taxCents))) : ""}
      ${totalRow("Invoice total", e(formatCents(view.totalCents)), true)}
      ${view.paid ? totalRow("Paid", `-${e(formatCents(view.totalCents))}`) : ""}
      ${totalRow("Balance due", e(formatCents(view.balanceDueCents)), true)}
      ${depositRow}
    </table>
    <p style="margin:18px 0 0;font-size:13px;color:${C.g500};">The PDF invoice is attached.</p>
  </td></tr>
  <tr><td style="padding:20px 28px 28px;">
    <p style="margin:0;font-size:14px;line-height:1.55;">Questions? Reply to this email or call <a href="tel:+1${COMPANY_PHONE.replace(/[^0-9]/g, "")}" style="color:${C.highlight};text-decoration:none;">${e(
      COMPANY_PHONE_DISPLAY
    )}</a>.</p>
    <p style="margin:12px 0 0;font-size:14px;color:${C.navy};"><strong>${e(COMPANY_NAME)}</strong></p>
  </td></tr>
  <tr><td style="background:${C.navy};padding:16px 28px;color:#94a3b8;font-size:12px;line-height:1.6;">
    ${e(COMPANY_NAME)} &middot; ${e(COMPANY_PHONE_DISPLAY)} &middot; <a href="https://${COMPANY_WEBSITE}" style="color:#94a3b8;">${COMPANY_WEBSITE}</a><br>
    ${e(COMPANY_ADDRESS)}
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
