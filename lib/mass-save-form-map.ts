// Field map for Mass Save's 2026 Residential Air Source Heat Pump Rebate Form
// (public/forms/mass-save-ashp-2026.pdf), page index 2 (the fillable page).
//
// Verified by dumping every AcroForm field's widget rectangles AND the page
// each widget actually belongs to (the template has 3 fillable pages worth
// of annotations total — page 2 is a separate eligibility checklist with its
// own similar-looking circles, which an earlier, buggier page-detection pass
// conflated with this page's fields). Only one field genuinely reuses the
// same name for two unrelated checkboxes on THIS page — "Check Box 40"
// controls both the Electric-Eversource box and the Whole-Home-rebate box —
// so that one is handled by setting a specific widget's /AS state directly
// (see mass-save-pdf-fill.ts) instead of the normal check() API, which would
// otherwise mark both boxes at once.

export const FORM_PAGE_INDEX = 2;

// PDF field name for each text value, from the official form's AcroForm.
export const MASS_SAVE_TEXT_FIELDS = {
  accountHolderName: "Text Field 54",
  accountHolderPhone: "Text Field 55",
  accountHolderEmail: "Text Field 58",
  installationAddress: "Text Field 56",
  installationCity: "Text Field 57",
  installationState: "Text Field 59",
  installationZip: "Text Field 60",
  mailingAddress: "Text Field 102",
  mailingCity: "Text Field 103",
  mailingState: "Text Field 104",
  mailingZip: "Text Field 105",
  electricAccountNumber: "Text Field 101",
  gasAccountNumber: "Text Field 100",
  installerCompanyName: "Text Field 61",
  installerHpinId: "Text Field 64",
  installerContactPerson: "Text Field 62",
  installerPhone: "Text Field 67",
  installerEmail: "Text Field 65",
  installerAddress: "Text Field 63",
  installerCity: "Text Field 68",
  installerState: "Text Field 69",
  installerZip: "Text Field 66",
  assessmentSiteId: "Text Field 79",
  totalSquareFootage: "Text Field 80",
  icModel: "Text Field 50",
  icSwitchoverTemp: "Text Field 51",
  icCount: "Text Field 52",
  icLocation: "Text Field 53",
  eq1InstallDate: "Text Field 84",
  eq1Ahri: "Text Field 85",
  eq1Btu: "Text Field 86",
  eq1Tons: "Text Field 87",
  eq1Area: "Text Field 88",
  eq2InstallDate: "Text Field 89",
  eq2Ahri: "Text Field 90",
  eq2Btu: "Text Field 91",
  eq2Tons: "Text Field 92",
  eq2Area: "Text Field 93",
  eq3InstallDate: "Text Field 94",
  eq3Ahri: "Text Field 95",
  eq3Btu: "Text Field 96",
  eq3Tons: "Text Field 97",
  eq3Area: "Text Field 98",
  signatureDate: "Text Field 99",
} as const;

export type MassSaveTextFieldKey = keyof typeof MASS_SAVE_TEXT_FIELDS;

// Every mark maps to a checkbox field name. "Check Box 40" is the one
// same-page shared field — its two entries carry a widgetIndex so the fill
// code can set that specific widget's /AS instead of the field's shared
// value (see the two "sharedField" entries below).
export const MASS_SAVE_MARKS: Record<string, { field: string; widgetIndex?: number }> = {
  electricCapeLightCompact: { field: "Check Box 112" },
  electricNationalGrid: { field: "Check Box 42" },
  electricOther: { field: "Check Box 50" },
  electricEversource: { field: "Check Box 40", widgetIndex: 0 },
  electricUnitil: { field: "Check Box 41" },

  gasBerkshireGas: { field: "Check Box 111" },
  gasLiberty: { field: "Check Box 1011" },
  gasUnitil: { field: "Check Box 110" },
  gasEversource: { field: "Check Box 43" },
  gasNationalGrid: { field: "Check Box 1010" },

  payeeInstaller: { field: "Check Box 27" },
  payeeOther: { field: "Check Box 26" },

  ownerOccupied: { field: "Check Box 54" },
  renterOccupied: { field: "Check Box 53" },

  housingSingleFamily: { field: "Check Box 57" },
  housing2to4Unit: { field: "Check Box 58" },
  housing5PlusUnit: { field: "Check Box 59" },

  multiUnit1: { field: "Check Box 61" },
  multiUnit2: { field: "Check Box 60" },
  multiUnit3: { field: "Check Box 62" },
  multiUnit4: { field: "Check Box 63" },

  heatingOil: { field: "Check Box 64" },
  heatingPropane: { field: "Check Box 65" },
  heatingElectricResistance: { field: "Check Box 66" },
  heatingNaturalGas: { field: "Check Box 67" },

  rebateWholeHome: { field: "Check Box 40", widgetIndex: 1 },
  rebatePartialHome: { field: "Check Box 114" },
  rebateWeatherizationBonus: { field: "Check Box 113" },
  rebateSizingBonus: { field: "Check Box 49" },
};

export type MassSaveMarkKey = keyof typeof MASS_SAVE_MARKS;
