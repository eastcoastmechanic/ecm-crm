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
export const COMPANY_ADDRESS = "";
export const COMPANY_PHONE = "";
