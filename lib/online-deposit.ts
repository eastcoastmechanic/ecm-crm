import { supabase } from "@/lib/supabase";
import { contractDepositCents } from "@/lib/contract-terms";
import { centsToMoney, notifyOwnerOfMoney } from "@/lib/notify-owner";
import { etDateKey } from "@/lib/tz";

// Online deposit on a signed contract. The amount always comes from the signed
// payment terms (contractDepositCents); the Stripe webhook records it here on
// the contract (deposit_received_cents) and never marks the contract paid.
// Replays are recognised by the payment id, kept in
// documents.deposit_payment_intent_ids (SQL 0075). Until that SQL is run the
// column is missing, so no deposit is offered and nothing here writes.

type ContractRow = {
  id: string;
  doc_number: string | null;
  type: string | null;
  status: string | null;
  total: number | string | null;
  customer_id: string | null;
  line_items: unknown;
  deposit_received_cents: number | null;
  deposit_payment_intent_ids?: string[] | null;
  customers?: { name: string | null } | { name: string | null }[] | null;
};

function paymentTerms(lineItems: unknown): string | null {
  const terms = (lineItems as { paymentTerms?: unknown } | null)?.paymentTerms;
  return typeof terms === "string" ? terms : null;
}

/** The contract's deposit in cents from its signed terms, or null when the terms don't give one. */
export function depositDueCents(doc: { total: number | string | null; line_items: unknown }): number | null {
  return contractDepositCents({ total: doc.total, paymentTerms: paymentTerms(doc.line_items) });
}

/**
 * The deposit to offer online, in cents, or null when none is offered: only a
 * signed contract whose terms give an amount and that has no deposit recorded
 * yet (online or by hand), and only once SQL 0075 is in (`ready`).
 */
export function offeredDepositCents(
  doc: {
    type: string | null;
    status: string | null;
    total: number | string | null;
    line_items: unknown;
    deposit_received_cents: number | null;
  },
  ready: boolean
): number | null {
  if (!ready || doc.type !== "contract" || doc.status !== "signed") return null;
  if ((doc.deposit_received_cents ?? 0) > 0) return null;
  return depositDueCents(doc);
}

const CONTRACT_COLUMNS =
  "id, doc_number, type, status, total, customer_id, line_items, deposit_received_cents, deposit_payment_intent_ids";

/**
 * Reads a contract for a deposit checkout with the service client. Pass the
 * portal customer's id to scope it to their own contract. `ready` is false
 * before SQL 0075 is run (the read without the new column still works).
 */
export async function loadDepositContract(
  documentId: string,
  customerId?: string
): Promise<{ doc: ContractRow | null; ready: boolean; error?: string }> {
  const read = (cols: string) => {
    let q = supabase.from("documents").select(cols).eq("id", documentId);
    if (customerId) q = q.eq("customer_id", customerId);
    return q.maybeSingle();
  };
  const { data, error } = await read(CONTRACT_COLUMNS);
  if (!error) return { doc: (data as unknown as ContractRow | null) ?? null, ready: true };
  if (!isMissingColumn(error)) return { doc: null, ready: false, error: error.message };
  const fallback = await read(CONTRACT_COLUMNS.replace(", deposit_payment_intent_ids", ""));
  if (fallback.error) return { doc: null, ready: false, error: fallback.error.message };
  return { doc: (fallback.data as unknown as ContractRow | null) ?? null, ready: false };
}

function isMissingColumn(error: { message?: string; code?: string }) {
  return error.code === "42703" || error.code === "PGRST204" || /deposit_payment_intent_ids/.test(error.message ?? "");
}

function customerName(doc: ContractRow) {
  const c = Array.isArray(doc.customers) ? doc.customers[0] : doc.customers;
  return c?.name ?? null;
}

function label(doc: ContractRow | null, fallbackId: string) {
  return [doc?.doc_number ?? fallbackId, doc ? customerName(doc) : null].filter(Boolean).join(", ");
}

export type DepositResult =
  | { status: "recorded"; recordedCents: number }
  | { status: "replay" }
  | { status: "mismatch" }
  | { status: "error"; error: string };

/**
 * Records a paid online deposit on its contract, once per Stripe payment.
 *
 * - The amount paid must equal the deposit in the signed terms; otherwise the
 *   owner gets an alert and nothing is recorded.
 * - It adds to any deposit already recorded and never goes past the contract
 *   total. It never touches the contract's status, so a contract never becomes
 *   "paid" from a deposit.
 * - A replay of the same payment changes nothing. The write only lands if the
 *   row still holds what was read (compare and swap), so two deliveries at
 *   once can't both add.
 *
 * Returns status "error" when Stripe should retry.
 */
export async function recordOnlineDeposit(input: {
  documentId: string;
  paymentIntentId: string | null;
  paidCents: number;
  sessionId: string;
}): Promise<DepositResult> {
  const { documentId, paymentIntentId, paidCents, sessionId } = input;
  const path = `/documents/${documentId}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from("documents")
      .select(`${CONTRACT_COLUMNS}, customers(name)`)
      .eq("id", documentId)
      .maybeSingle();
    if (error) return { status: "error", error: error.message };
    const doc = (data as unknown as ContractRow | null) ?? null;

    if (!doc || doc.type !== "contract" || !paymentIntentId) {
      await notifyOwnerOfMoney({
        title: `Deposit paid online, not recorded (${label(doc, documentId)})`,
        body: `Stripe took ${centsToMoney(paidCents)} as a deposit, but ${
          !doc ? "the contract isn't in the CRM" : !paymentIntentId ? "the payment has no id" : "the document isn't a contract"
        }. Nothing was recorded. Check it in Stripe (session ${sessionId}).`,
        path: doc ? path : undefined,
      });
      return { status: "mismatch" };
    }

    const seen = doc.deposit_payment_intent_ids ?? [];
    if (seen.includes(paymentIntentId)) return { status: "replay" };

    const expected = depositDueCents(doc);
    if (expected == null || paidCents !== expected) {
      console.error(
        `[online-deposit] amount mismatch on ${documentId}: paid ${paidCents}c, terms ${expected ?? "none"} (session ${sessionId})`
      );
      await notifyOwnerOfMoney({
        title: `Deposit payment does not match the contract (${label(doc, documentId)})`,
        body: `The customer paid ${centsToMoney(paidCents)} but the contract's deposit is ${
          expected == null ? "not set in its payment terms" : centsToMoney(expected)
        }. The deposit was NOT recorded. Check the contract and Stripe (payment ${paymentIntentId}).`,
        path,
      });
      return { status: "mismatch" };
    }

    const totalCents = Math.round(Number(doc.total) * 100);
    const before = doc.deposit_received_cents ?? 0;
    const after = Math.min(totalCents, before + paidCents);

    let update = supabase
      .from("documents")
      .update({
        deposit_received_cents: after,
        deposit_received_at: etDateKey(),
        deposit_method: "card",
        deposit_payment_intent_ids: [...seen, paymentIntentId],
      })
      .eq("id", documentId)
      .eq("type", "contract");
    update = doc.deposit_received_cents == null ? update.is("deposit_received_cents", null) : update.eq("deposit_received_cents", doc.deposit_received_cents);
    update =
      doc.deposit_payment_intent_ids == null
        ? update.is("deposit_payment_intent_ids", null)
        : update.eq("deposit_payment_intent_ids", `{${seen.join(",")}}`);
    const { data: written, error: writeError } = await update.select("id");
    if (writeError) return { status: "error", error: writeError.message };
    // Someone else changed the row between the read and the write: read again.
    if (!written || written.length === 0) continue;

    const notes = [
      `Recorded on the contract as a card deposit. Balance due at completion ${centsToMoney(Math.max(0, totalCents - after))}.`,
    ];
    if (before > 0) {
      notes.push(
        `A deposit of ${centsToMoney(before)} was already recorded, so the customer may have paid twice. Check Stripe and refund the extra one.`
      );
    }
    if (after < before + paidCents) notes.push(`The recorded deposit was held to the contract total.`);
    await notifyOwnerOfMoney({
      title: `Deposit paid online: ${centsToMoney(paidCents)} on ${label(doc, documentId)}`,
      body: notes.join(" "),
      path,
    });
    return { status: "recorded", recordedCents: after };
  }

  return { status: "error", error: "The contract kept changing while the deposit was recorded; Stripe will retry." };
}
