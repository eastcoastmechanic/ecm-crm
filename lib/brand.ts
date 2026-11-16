/**
 * Single source of truth for company-wide brand strings.
 *
 * The tagline previously lived as a literal in each PDF renderer, which drifted:
 * lib/pdf.tsx was updated to "Heating | Cooling | Plumbing | Air Quality" while
 * the assessment, warranty, and service reports were left on the older
 * "HVAC & PLUMBING" — so three of the four customer-facing documents carried
 * stale branding. Import from here instead of re-typing the string.
 */

export const COMPANY_NAME = "East Coast Mechanical";

/** Displayed under the company name on every generated document. */
export const COMPANY_SLOGAN = "BUILT WITH PRIDE  ·  INSTALLED WITH PRECISION";

/**
 * Massachusetts requires a Home Improvement Contractor registration number
 * on the face of any residential home-improvement contract over $1,000
 * (MGL c.142A §2). lib/contract-pdf.tsx renders a visible warning in place
 * of this until it's filled in — a contract missing it is a compliance
 * defect, not just an omission, so leaving the placeholder obvious is
 * intentional rather than a bug to silently work around.
 */
export const HIC_REGISTRATION_NUMBER = "";

/** Same face-of-contract requirement as the HIC number above — fill in before issuing a real contract. */
export const COMPANY_ADDRESS = "37 Plaza Way, Unit 2304, Plymouth, MA 02360";
export const COMPANY_PHONE = "774-343-6369";
/** Parenthesized form used on the preventive-maintenance report. */
export const COMPANY_PHONE_DISPLAY = "(774) 343-6369";
export const COMPANY_EMAIL = "joshcrowleyecm@outlook.com";

/** Customer-facing website, shown on invoices and used for the portal link. */
export const COMPANY_WEBSITE = "eastcoastmechanical.org";

/**
 * Optional license line printed under the business details on invoices, for
 * example "MA Plumbing Lic. #12345". Not in the code because the numbers are
 * not on file: set COMPANY_LICENSE_LINE on Vercel and it appears on the next
 * invoice. Empty means the line is left off. HIC_REGISTRATION_NUMBER above is
 * printed too once it is filled in.
 */
export function companyLicenseLine(): string {
  const parts = [(process.env.COMPANY_LICENSE_LINE ?? "").trim()];
  if (HIC_REGISTRATION_NUMBER) parts.push(`MA HIC #${HIC_REGISTRATION_NUMBER}`);
  return parts.filter(Boolean).join("  ·  ");
}

/** The customer portal, where a signed-in customer can open and pay an invoice any time. */
export const CUSTOMER_PORTAL_URL = `https://${COMPANY_WEBSITE}/portal`;

/** Logo for HTML emails (a public file on the website; PNG paths skip the sign-in proxy). */
export const EMAIL_LOGO_URL = `https://${COMPANY_WEBSITE}/logo-mark.png`;
