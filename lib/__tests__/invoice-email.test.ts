import { describe, expect, it } from "vitest";
import { buildInvoiceView } from "@/lib/invoice-view";
import { escapeHtml, invoiceEmailHtml, invoiceEmailSubject, invoiceEmailText, payButtonUrl } from "@/lib/invoice-email";

const lines = [{ description: "Work <b>", category: "Labor", notes: null, qty: 1, unit: "ea", better: 250 }];
const base = {
  customerName: "Pat Example",
  docNumber: "INV-1",
  serviceAddress: "1 Test St",
  dueDate: "2026-12-10",
  todayKey: "2026-11-11",
  checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_1",
  portalUrl: "https://eastcoastmechanical.org/portal",
  logoUrl: "https://eastcoastmechanical.org/logo-mark.png",
};
const owing = { ...base, view: buildInvoiceView({ lines, total: 250, status: "sent" }) };
const paid = { ...base, view: buildInvoiceView({ lines, total: 250, status: "paid" }) };

describe("invoice email", () => {
  it("subject carries the amount and due date", () => {
    expect(invoiceEmailSubject(owing)).toBe("Invoice INV-1 from East Coast Mechanical: $250.00, due December 10, 2026");
    expect(invoiceEmailSubject(paid)).toBe("Invoice INV-1 from East Coast Mechanical: paid, thank you");
  });

  it("Pay invoice opens the Stripe link, or the portal when there isn't one, and never on a paid invoice", () => {
    expect(payButtonUrl(owing)).toBe(base.checkoutUrl);
    expect(payButtonUrl({ ...owing, checkoutUrl: null })).toBe(base.portalUrl);
    expect(payButtonUrl(paid)).toBeNull();
    const html = invoiceEmailHtml(owing);
    expect(html).toContain(`href="${base.checkoutUrl}"`);
    expect(html).toContain("Pay invoice");
    expect(html).toContain("$250.00");
    expect(invoiceEmailHtml(paid)).not.toContain("Pay invoice");
  });

  it("escapes customer-entered text", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    const html = invoiceEmailHtml({ ...owing, customerName: "<script>x</script>" });
    expect(html).not.toContain("<script>x");
    expect(html).toContain("Work &lt;b&gt;");
  });

  it("plain-text copy has the amount, due date and both pay links", () => {
    const text = invoiceEmailText(owing);
    expect(text).toContain("Hi Pat,");
    expect(text).toContain("Amount due: $250.00");
    expect(text).toContain("Due by: December 10, 2026");
    expect(text).toContain(base.checkoutUrl);
    expect(text).toContain(base.portalUrl);
    expect(invoiceEmailText(paid)).not.toContain("Amount due");
  });

  it("flags past due", () => {
    expect(invoiceEmailHtml({ ...owing, todayKey: "2026-12-11" })).toContain("PAST DUE");
    expect(invoiceEmailHtml(owing)).not.toContain("PAST DUE");
  });
});
