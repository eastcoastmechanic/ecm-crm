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
