/**
 * Contract boilerplate for residential HVAC work in Massachusetts.
 *
 * IMPORTANT: this text is drafted to cover the disclosures Massachusetts'
 * Home Improvement Contractor law (MGL c.142A §2) requires on the face of a
 * residential contract over $1,000 — the buyer's 3-business-day right to
 * cancel, a Notice of Cancellation form, and notice of the right to elect
 * arbitration for disputes. It is NOT a substitute for review by a
 * Massachusetts attorney before this is used to bind a real customer —
 * get it reviewed once, then it's reusable on every contract after.
 */
import { COMPANY_NAME } from "./brand";

export type ContractLineItems = {
  scopeOfWork: string;
  paymentTerms: string;
  warrantyTerms: string;
  startDate: string | null;
  estimatedCompletion: string | null;
  notes: string | null;
  fromDocumentId?: string | null;
};

export const DEFAULT_WARRANTY_TERMS =
  `${COMPANY_NAME} warrants that this installation will be completed correctly and in accordance with manufacturer specifications and applicable code. If a defect in our workmanship causes a failure within 1 year of completion, we will repair or correct it at no charge for labor. Manufacturer warranties on equipment and parts are separate and are the manufacturer's responsibility per their published terms. This warranty does not cover normal wear and tear, damage from misuse or lack of maintenance, acts of nature, or work not performed by ${COMPANY_NAME}.`;

export const DEFAULT_PAYMENT_TERMS =
  "A deposit is due upon signing, with the balance due upon completion of work. Payment methods and any financing terms will be confirmed separately. Massachusetts law caps deposits on home improvement contracts at one-third of the total contract price, or the cost of special-order materials, whichever is greater.";

/**
 * MGL c.142A §2(a)(9) / FTC 16 CFR Part 429: the buyer may cancel within 3
 * business days of the transaction date printed in the contract header, for
 * any reason, with a full refund of any deposit.
 */
export const RIGHT_TO_CANCEL_NOTICE =
  "You, the buyer, may cancel this transaction at any time prior to midnight of the third business day after the date of this transaction (see date above). See the attached Notice of Cancellation for an explanation of this right.";

export function noticeOfCancellationText(transactionDate: string, docNumber: string | null): string {
  return [
    "NOTICE OF CANCELLATION",
    `Contract: ${docNumber ?? ""}      Date of transaction: ${transactionDate}`,
    "",
    "You may CANCEL this transaction, without any penalty or obligation, within THREE BUSINESS DAYS from the above date.",
    "",
    `If you cancel, any property traded in, any payments made by you under the contract, and any negotiable instrument executed by you will be returned within 10 business days following receipt by ${COMPANY_NAME} of your cancellation notice, and any security interest arising out of the transaction will be cancelled.`,
    "",
    `If you cancel, you must make available to ${COMPANY_NAME}, at your residence, in substantially as good condition as when received, any goods delivered to you under this contract; or you may, if you wish, comply with the instructions of ${COMPANY_NAME} regarding the return shipment of the goods at ${COMPANY_NAME}'s expense and risk.`,
    "",
    `If you do make the goods available to ${COMPANY_NAME} and ${COMPANY_NAME} does not pick them up within 20 days of the date of your Notice of Cancellation, you may retain or dispose of the goods without any further obligation. If you fail to make the goods available to ${COMPANY_NAME}, or if you agree to return the goods to ${COMPANY_NAME} and fail to do so, you remain liable for performance of all obligations under the contract.`,
    "",
    `To cancel this transaction, mail or deliver a signed and dated copy of this Notice of Cancellation, or any other written notice, to ${COMPANY_NAME} at the address on this contract, not later than midnight of the third business day after the date of this transaction.`,
  ].join("\n");
}

/**
 * MGL c.142A §2(a)(10): homeowners have the right to initiate arbitration
 * against a HIC-registered contractor through a state-approved program.
 * Naming a specific program here would be a factual claim this codebase
 * can't verify — confirm enrollment and insert the actual program name
 * before this goes to a real customer.
 */
export const ARBITRATION_NOTICE_TEXT =
  "Any disputes arising under this contract may be subject to arbitration under the process established by the Massachusetts Office of Consumer Affairs and Business Regulation's Home Improvement Contractor Arbitration Program. Owner is not required to accept arbitration and retains the right to pursue judicial remedies.";

export const GOVERNING_TERMS_TEXT =
  "This contract constitutes the entire agreement between the parties and supersedes any prior oral or written understanding. If any provision of this contract is held invalid, the remainder shall continue in full force. This contract is governed by the laws of the Commonwealth of Massachusetts.";
