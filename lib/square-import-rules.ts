// Pure rules for importing Square customers into the CRM. No database imports so they can be tested.
// Nothing here invents data: a CRM customer is made only from what Square actually has on file.

export type SquareCust = {
  id?: string;
  given_name?: string;
  family_name?: string;
  company_name?: string;
  email_address?: string;
  phone_number?: string;
};

export type CrmCust = {
  id: string;
  email: string | null;
  phone: string | null;
  square_customer_id: string | null;
};

export type NewCustomer = {
  square_customer_id: string;
  name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
};

export type ImportPlan = {
  toCreate: NewCustomer[];
  /** Square customer id -> existing CRM customer id, matched by email or phone. */
  toLink: { crmId: string; squareId: string }[];
  alreadyLinked: number;
  /** Nothing usable on the Square record (no name, email or phone). */
  skipped: number;
};

/** Writes sms_consent=false for every imported customer: Square holds no text opt-in for the CRM. */
export const IMPORTED_SMS_CONSENT = false;

export function digits(phone: string | null | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

export function squareDisplayName(c: SquareCust): string {
  const person = [c.given_name, c.family_name].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  return person || (c.company_name ?? "").trim();
}

export function planCustomerImport(square: SquareCust[], crm: CrmCust[]): ImportPlan {
  const linkedSquareIds = new Set(crm.map((c) => c.square_customer_id).filter(Boolean) as string[]);
  // Only unlinked CRM customers can be matched to, so two Square records never claim one CRM row.
  const byEmail = new Map<string, CrmCust>();
  const byPhone = new Map<string, CrmCust>();
  for (const c of crm) {
    if (c.square_customer_id) continue;
    const e = c.email?.trim().toLowerCase();
    if (e && !byEmail.has(e)) byEmail.set(e, c);
    const p = digits(c.phone);
    if (p.length === 10 && !byPhone.has(p)) byPhone.set(p, c);
  }

  const plan: ImportPlan = { toCreate: [], toLink: [], alreadyLinked: 0, skipped: 0 };
  const claimed = new Set<string>();
  const seenSquare = new Set<string>();

  for (const s of square) {
    if (!s.id || seenSquare.has(s.id)) continue;
    seenSquare.add(s.id);
    if (linkedSquareIds.has(s.id)) {
      plan.alreadyLinked += 1;
      continue;
    }
    const email = s.email_address?.trim() || null;
    const phone = s.phone_number?.trim() || null;
    const name = squareDisplayName(s);
    if (!name && !email && !phone) {
      plan.skipped += 1;
      continue;
    }
    const match =
      (email ? byEmail.get(email.toLowerCase()) : undefined) ??
      (digits(phone).length === 10 ? byPhone.get(digits(phone)) : undefined);
    if (match && !claimed.has(match.id)) {
      claimed.add(match.id);
      plan.toLink.push({ crmId: match.id, squareId: s.id });
      continue;
    }
    plan.toCreate.push({
      square_customer_id: s.id,
      name: name || email || phone || "Square customer",
      company_name: s.company_name?.trim() && name !== s.company_name.trim() ? s.company_name.trim() : null,
      email,
      phone,
    });
  }
  return plan;
}

/** Square writes (customers, orders, draft invoices) are off unless this is explicitly "true". */
export function squareWritesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SQUARE_WRITES_ENABLED === "true";
}
