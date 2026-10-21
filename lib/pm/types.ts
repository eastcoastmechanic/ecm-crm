/** Shared shapes for preventive-maintenance templates, checklists, and reports. */

export type PmAudience = "residential" | "commercial";

export type PmResult = "pass" | "fail" | "na";

export type PmReadingInput = "number" | "text";

export type PmReadingField = {
  key: string;
  label: string;
  unit?: string;
  input: PmReadingInput;
};

export type PmTemplateItem = {
  key: string;
  section: string;
  label: string;
  help?: string;
  readings: PmReadingField[];
};

export type PmTemplate = {
  slug: string;
  name: string;
  audience: PmAudience;
  items: PmTemplateItem[];
};

/** Values the tech typed. Empty string means "left blank". */
export type PmReadings = Record<string, string>;

export type PmPhoto = {
  path: string;
  caption?: string | null;
  taken_at?: string;
};

export type PmChecklistItem = {
  id?: string;
  item_key: string;
  section: string;
  label: string;
  help?: string | null;
  sort_order: number;
  result: PmResult | null;
  readings: PmReadings;
  reading_fields: PmReadingField[];
  notes: string | null;
  photos: PmPhoto[];
};

export type PmReportReading = {
  label: string;
  value: string;
  unit?: string;
};

export type PmReportItem = {
  key: string;
  section: string;
  label: string;
  result: PmResult | null;
  notes: string | null;
  readings: PmReportReading[];
  photos: { url: string | null; caption: string | null }[];
};

export type PmReportModel = {
  doc_number: string | null;
  checklist_id: string;
  title: string;
  date_label: string;
  tech_name: string | null;
  customer_name: string;
  property_address: string | null;
  equipment_label: string;
  equipment_serial: string | null;
  audience_label: string;
  recommendations: string | null;
  summary: { pass: number; fail: number; na: number; open: number };
  failures: PmReportItem[];
  sections: { name: string; items: PmReportItem[] }[];
};
