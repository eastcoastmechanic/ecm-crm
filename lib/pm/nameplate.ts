/**
 * Data-plate proposals.
 *
 * A scan never writes the equipment row. The tech confirms each field, and
 * `mergeNameplateIdentity` refuses to replace a value that is already on file
 * unless that field is in the confirmed set. Empty fields can be filled
 * without a separate confirmation — there is nothing to overwrite.
 */

export type NameplateField = "brand" | "model" | "serial_number" | "manufacture_date" | "type" | "refrigerant_type";

export type NameplateIdentity = Record<NameplateField, string | null>;

export const NAMEPLATE_FIELDS: NameplateField[] = [
  "brand",
  "model",
  "serial_number",
  "manufacture_date",
  "type",
  "refrigerant_type",
];

const FIELD_LABEL: Record<NameplateField, string> = {
  brand: "Manufacturer",
  model: "Model",
  serial_number: "Serial",
  manufacture_date: "Manufacture date",
  type: "Type",
  refrigerant_type: "Refrigerant",
};

export function nameplateFieldLabel(field: NameplateField): string {
  return FIELD_LABEL[field];
}

export function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const CARRIER_FAMILY = [
  "carrier",
  "bryant",
  "payne",
  "day & night",
  "day and night",
  "comfortmaker",
  "tempstar",
  "heil",
  "keeprite",
  "arcoaire",
  "icp",
];

const GOODMAN_FAMILY = ["goodman", "amana", "janitrol"];

function brandMatches(brand: string, family: string[]): boolean {
  const normalized = brand.toLowerCase();
  return family.some((name) => normalized.includes(name));
}

function fullYear(twoDigit: number, now: Date): number | null {
  if (twoDigit < 0 || twoDigit > 99) return null;
  const currentTwo = now.getFullYear() % 100;
  // A year one ahead is allowed (a unit built late in the calendar year).
  // Anything further ahead is a misread, not a future unit.
  if (twoDigit > currentTwo + 1) return 1900 + twoDigit;
  return 2000 + twoDigit;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Decode a manufacture date from a serial when the brand uses a known,
 * unambiguous code. Returns null rather than a guess for every other brand.
 * The string is a proposal for the tech to confirm, not a saved fact.
 */
export function decodeManufactureDate(
  brand: string | null | undefined,
  serial: string | null | undefined,
  now: Date = new Date()
): string | null {
  const brandText = blankToNull(brand);
  const serialText = blankToNull(serial);
  if (!brandText || !serialText) return null;

  const digits = serialText.replace(/[^0-9a-z]/gi, "");
  const head = digits.slice(0, 4);
  if (!/^\d{4}$/.test(head)) return null;

  if (brandMatches(brandText, CARRIER_FAMILY)) {
    const week = Number(head.slice(0, 2));
    const year = fullYear(Number(head.slice(2, 4)), now);
    if (!year || week < 1 || week > 53) return null;
    return `Week ${week}, ${year}`;
  }

  if (brandMatches(brandText, GOODMAN_FAMILY)) {
    const year = fullYear(Number(head.slice(0, 2)), now);
    const month = Number(head.slice(2, 4));
    if (!year || month < 1 || month > 12) return null;
    return `${MONTHS[month - 1]} ${year}`;
  }

  return null;
}

export type NameplateMergeResult = {
  next: NameplateIdentity;
  /** Fields that replaced a previous non-empty value. */
  overwritten: NameplateField[];
  /** Posted a different non-empty value without confirmation. Nothing was written for these. */
  conflicts: NameplateField[];
};

export function mergeNameplateIdentity(
  existing: NameplateIdentity,
  submitted: NameplateIdentity,
  confirmed: ReadonlySet<NameplateField>
): NameplateMergeResult {
  const next: NameplateIdentity = { ...existing };
  const overwritten: NameplateField[] = [];
  const conflicts: NameplateField[] = [];

  for (const field of NAMEPLATE_FIELDS) {
    const incoming = blankToNull(submitted[field]);
    const current = blankToNull(existing[field]);
    if (!incoming || incoming === current) continue;
    if (!current) {
      next[field] = incoming;
      continue;
    }
    if (confirmed.has(field)) {
      next[field] = incoming;
      overwritten.push(field);
      continue;
    }
    conflicts.push(field);
  }

  return { next, overwritten, conflicts };
}

export type NameplateExtras = Record<string, string | null>;

/**
 * Copy plate details (voltage, BTU, …) onto the stored nameplate object.
 * A key that already has a value is left alone. `photo_path` is set when a
 * new plate photo was stored for this confirmation.
 */
export function mergeNameplateExtras(
  existing: NameplateExtras | null | undefined,
  incoming: NameplateExtras | null | undefined,
  photoPath: string | null
): NameplateExtras {
  const next: NameplateExtras = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(incoming ?? {})) {
    const proposed = blankToNull(value);
    if (!proposed) continue;
    if (blankToNull(next[key] == null ? null : String(next[key]))) continue;
    next[key] = proposed;
  }
  if (photoPath) next.photo_path = photoPath;
  return next;
}

export function conflictMessage(conflicts: NameplateField[]): string {
  const labels = conflicts.map(nameplateFieldLabel);
  return `Already on file: ${labels.join(", ")}. Check Replace to overwrite those, or leave them as they are.`;
}
